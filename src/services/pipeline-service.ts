import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Company, SignalFinding, PipelineResult, CompanyPipelineResult } from "@/lib/types";
import {
  getTrackedActiveCompanies,
  getCompanyById,
  getTrackingOrgs,
  getTrackedCompanies,
  updateLastAgentRun,
} from "@/services/company-service";
import { sendDigestEmail } from "@/services/email-service";
import { runIntelligenceAgentsSilent } from "@/services/orchestrator";
import {
  generateReportFromFindings,
  storeReport,
} from "@/services/report-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import { getOrganizationMembers } from "@/services/organization-service";
import {
  type EmailFrequency,
  getUserSettings,
} from "@/services/user-service";

const FREQUENCY_INTERVAL_DAYS: Record<EmailFrequency, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
  monthly: 30,
};

interface OrgRecipient {
  email: string;
  emailFrequency: EmailFrequency;
}

function shouldRunToday(
  frequency: EmailFrequency,
  lastRun: string | null,
): boolean {
  const intervalDays = FREQUENCY_INTERVAL_DAYS[frequency] || 1;
  if (!lastRun) return true;
  const daysSince =
    (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= intervalDays;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    console.warn("[PIPELINE] Invalid detected_at value %j, storing as null", value);
    return null;
  }
  return parsed.toISOString();
}

/**
 * Deduplicate findings against existing signals in the database.
 *
 * Layer 1: Exact title match (case-insensitive, trimmed). Same title = duplicate.
 * Layer 2: Deep URL match (3+ path segments). Same URL on a specific page = duplicate.
 *
 * One SQL query per check. Also deduplicates within the current batch.
 */
async function deduplicateFindings(
  companyId: string,
  findings: SignalFinding[],
): Promise<SignalFinding[]> {
  if (findings.length === 0) return findings;

  const supabase = createAdminClient();
  const newFindings: SignalFinding[] = [];
  const batchTitles = new Set<string>();

  for (const finding of findings) {
    const titleLower = (finding.title ?? "").trim().toLowerCase();

    // Layer 1a: Check within current batch
    if (batchTitles.has(titleLower)) {
      console.log(
        "[DEDUP] DUPLICATE — title: \"%s\" | reason: duplicate within same batch",
        finding.title,
      );
      continue;
    }

    // Layer 1b: Check title against database
    const { count, error } = await supabase
      .from("signals")
      .select("signal_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .ilike("title", titleLower);

    if (error) {
      console.warn("[DEDUP] Query failed for \"%s\", keeping signal: %s", finding.title, error.message);
      newFindings.push(finding);
      batchTitles.add(titleLower);
      continue;
    }

    if ((count ?? 0) > 0) {
      console.log(
        "[DEDUP] DUPLICATE — title: \"%s\" | reason: exact title match in DB",
        finding.title,
      );
      continue;
    }

    // Layer 2: Deep URL match
    if (finding.url) {
      let pathDepth = 0;
      try {
        pathDepth = new URL(finding.url).pathname.split("/").filter(Boolean).length;
      } catch {}

      if (pathDepth >= 3) {
        const { count: urlCount } = await supabase
          .from("signals")
          .select("signal_id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("url", finding.url);

        if ((urlCount ?? 0) > 0) {
          console.log(
            "[DEDUP] DUPLICATE — title: \"%s\" | url: %s | reason: deep URL match (depth %d)",
            finding.title, finding.url, pathDepth,
          );
          continue;
        }
      }
    }

    console.log(
      "[DEDUP] NEW — title: \"%s\" | signal_type: %s",
      finding.title, finding.signal_type,
    );
    newFindings.push(finding);
    batchTitles.add(titleLower);
  }

  return newFindings;
}

/**
 * LLM-based semantic dedup using Haiku.
 * For each finding that passed the fast filters, ask Haiku if it's semantically
 * a duplicate of any recent existing signal of the same type.
 * All LLM calls run in parallel. Fails open (keeps signal if LLM errors).
 */
async function llmDedup(
  companyId: string,
  findings: SignalFinding[],
): Promise<SignalFinding[]> {
  if (findings.length === 0) return findings;

  const supabase = createAdminClient();

  // Group findings by signal_type so we can batch the DB lookups
  const byType = new Map<string, SignalFinding[]>();
  for (const f of findings) {
    if (!byType.has(f.signal_type)) byType.set(f.signal_type, []);
    byType.get(f.signal_type)!.push(f);
  }

  // Fetch existing signals per type (one query per type, cached)
  const existingByType = new Map<string, Array<{ title: string; content: string; source: string }>>();
  const urlCache = new Map<string, Array<{ title: string; content: string; source: string }>>();
  for (const signalType of byType.keys()) {
    const { data } = await supabase
      .from("signals")
      .select("title, content, source")
      .eq("company_id", companyId)
      .eq("signal_type", signalType)
      .order("created_at", { ascending: false })
      .limit(10);
    existingByType.set(signalType, data ?? []);
  }

  // Run LLM checks in parallel
  const results = await Promise.all(
    findings.map(async (finding): Promise<{ finding: SignalFinding; keep: boolean }> => {
      const existingBySignalType = existingByType.get(finding.signal_type) ?? [];

      // Also fetch signals with the same source URL (if finding has one)
      let existingByUrl: Array<{ title: string; content: string; source: string }> = [];
      if (finding.url) {
        if (!urlCache.has(finding.url)) {
          const { data } = await supabase
            .from("signals")
            .select("title, content, source")
            .eq("company_id", companyId)
            .eq("url", finding.url)
            .order("created_at", { ascending: false })
            .limit(10);
          urlCache.set(finding.url, data ?? []);
        }
        existingByUrl = urlCache.get(finding.url)!;
      }

      // Merge and deduplicate the comparison set
      const seen = new Set<string>();
      const existing: Array<{ title: string; content: string; source: string }> = [];
      for (const s of [...existingBySignalType, ...existingByUrl]) {
        const key = s.title.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          existing.push(s);
        }
      }

      // Nothing to compare against — keep it
      if (existing.length === 0) {
        console.log(
          "[DEDUP-LLM] SKIP (no existing signals to compare) — title: \"%s\"",
          finding.title,
        );
        return { finding, keep: true };
      }

      // Build the comparison list
      const existingList = existing
        .map((s, i) => `${i + 1}. "${s.title}" — ${s.content?.slice(0, 100) ?? ""} (source: ${s.source})`)
        .join("\n");

      const prompt = `You are a deduplication checker. Determine if the NEW signal is a duplicate of any EXISTING signal.

Two signals are DUPLICATES if they:
- Describe the same event, announcement, or fact — even if worded differently
- Profile the same company as a competitor — even with different titles or descriptions
- Cover the same person (e.g. same founder/CEO listed twice with different formatting)
- Report the same data point (e.g. same funding round, same metric, same product)

EXISTING SIGNALS for this company (${finding.signal_type}):
${existingList}

NEW SIGNAL:
Title: "${finding.title}"
Summary: ${finding.summary}
Source: ${finding.source}

Is this new signal a duplicate of any existing signal above?
Respond with ONLY "YES" or "NO" on the first line.
If YES, add a second line with the number of the matching existing signal.`;

      try {
        const { text } = await generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          prompt,
        });

        const answer = text.trim().split("\n")[0].trim().toUpperCase();
        const isDuplicate = answer === "YES";

        if (isDuplicate) {
          const matchLine = text.trim().split("\n")[1]?.trim() ?? "";
          console.log(
            "[DEDUP-LLM] DUPLICATE — title: \"%s\" | reason: semantic match | LLM said: %s %s",
            finding.title, answer, matchLine,
          );
        } else {
          console.log(
            "[DEDUP-LLM] NEW — title: \"%s\" | LLM confirmed not a duplicate",
            finding.title,
          );
        }

        return { finding, keep: !isDuplicate };
      } catch (err) {
        // Fail open — if LLM errors, keep the signal
        console.warn(
          "[DEDUP-LLM] ERROR — title: \"%s\" | keeping signal | error: %s",
          finding.title, (err as Error).message,
        );
        return { finding, keep: true };
      }
    }),
  );

  const kept = results.filter((r) => r.keep).map((r) => r.finding);
  const filtered = results.filter((r) => !r.keep).length;
  console.log("[DEDUP-LLM] Result: %d kept, %d filtered as semantic duplicates", kept.length, filtered);

  return kept;
}

async function storeSignals(
  companyId: string,
  findings: SignalFinding[],
): Promise<void> {
  if (findings.length === 0) return;

  const supabase = createAdminClient();
  const rows = findings.map((finding) => ({
    company_id: companyId,
    signal_definition_id: finding.signal_definition_id || null,
    signal_type: finding.signal_type,
    source: finding.source,
    title: finding.title,
    content: finding.summary,
    url: finding.url || null,
    detected_at: sanitizeTimestamp(finding.detected_at),
  }));

  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    throw new Error(`[PIPELINE] Signal store failed: ${error.message}`);
  }
}

async function getOrgRecipientEmails(
  organizationId: string,
): Promise<OrgRecipient[]> {
  const members = await getOrganizationMembers(organizationId);
  const activeMembers = members.filter(
    (m): m is typeof m & { user_id: string } => m.user_id !== null,
  );

  const recipients = await Promise.all(
    activeMembers.map(async (member) => {
      const settings = await getUserSettings(member.user_id);
      const email = settings.email || member.email || null;
      return email
        ? {
            email,
            emailFrequency: settings.email_frequency,
          }
        : null;
    }),
  );

  const seen = new Set<string>();
  return recipients.filter((recipient): recipient is OrgRecipient => {
    if (!recipient) return false;
    if (seen.has(recipient.email)) return false;
    seen.add(recipient.email);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Process a single company (core pipeline unit)
// ---------------------------------------------------------------------------

export async function processCompany(
  company: Company,
): Promise<CompanyPipelineResult> {
  const tag = `[PIPELINE] [${company.company_name}]`;
  const startTime = Date.now();

  try {
    console.log("%s Starting (%s)", tag, company.company_id);

    // 1. Load signal definitions (platform-level for this company)
    const definitions = await getSignalDefinitions(company.company_id);
    const enabledDefinitions = definitions.filter((d) => d.enabled);
    console.log(
      "%s Loaded %d definitions (%d enabled)",
      tag,
      definitions.length,
      enabledDefinitions.length,
    );

    // 2. Run intelligence agents
    console.log("%s Running intelligence agents...", tag);
    const findings = await runIntelligenceAgentsSilent(company, enabledDefinitions);
    console.log("%s Agents returned %d findings", tag, findings.length);

    // 3. Deduplicate against existing signals (fast filters: title+date, URL)
    const newFindings = await deduplicateFindings(company.company_id, findings);
    console.log("%s After fast dedup: %d new signals (filtered %d duplicates)", tag, newFindings.length, findings.length - newFindings.length);

    // 4. LLM semantic dedup (catches same event described differently)
    const finalFindings = await llmDedup(company.company_id, newFindings);
    console.log("%s After LLM dedup: %d signals (filtered %d more)", tag, finalFindings.length, newFindings.length - finalFindings.length);

    // 5. Store final findings in DB
    if (finalFindings.length > 0) {
      await storeSignals(company.company_id, finalFindings);
      console.log("%s Stored %d signals", tag, finalFindings.length);

      // 6. Generate & store report
      const reportData = generateReportFromFindings(company, finalFindings, definitions);
      const report = await storeReport(company.company_id, reportData, "cron");
      console.log("%s Report stored (%d sections)", tag, reportData.sections.length);

      await updateLastAgentRun(company.company_id);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log("%s Done in %ss — %d new signals", tag, elapsed, finalFindings.length);

      return {
        companyId: company.company_id,
        companyName: company.company_name,
        signalCount: finalFindings.length,
        reportId: report.report_id,
        findings: finalFindings,
      };
    }

    // Nothing new
    await updateLastAgentRun(company.company_id);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("%s Done in %ss — no new signals", tag, elapsed);

    return {
      companyId: company.company_id,
      companyName: company.company_name,
      signalCount: 0,
      findings: [],
    };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(
      "%s FAILED after %ss: %s",
      tag,
      elapsed,
      error instanceof Error ? error.message : String(error),
    );
    return {
      companyId: company.company_id,
      companyName: company.company_name,
      signalCount: 0,
      error: error instanceof Error ? error.message : String(error),
      findings: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Run full pipeline (all tracked companies) + send digest emails
// ---------------------------------------------------------------------------

export async function runPipeline(
  companyIds?: string[],
): Promise<PipelineResult> {
  const pipelineStart = Date.now();

  // Build a map of company_id → Company for the digest
  const companyMap = new Map<string, Company>();

  let companies: Company[];

  if (companyIds && companyIds.length > 0) {
    // Fetch specific companies
    const fetched = await Promise.all(companyIds.map((id) => getCompanyById(id)));
    companies = fetched.filter((c): c is Company => c !== null);
    if (companies.length === 0) throw new Error("None of the specified companies were found");
  } else {
    companies = await getTrackedActiveCompanies();
  }

  if (companies.length === 0) {
    console.log("[PIPELINE] No tracked active companies to process");
    return { companiesProcessed: 0, results: [], elapsed_seconds: 0 };
  }

  for (const c of companies) companyMap.set(c.company_id, c);

  console.log("[PIPELINE] Processing %d companies", companies.length);

  // Process all companies
  const results: CompanyPipelineResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((company) => processCompany(company)),
    );
    results.push(...batchResults);
  }

  // Collect companies that had new signals
  const companiesWithUpdates = results.filter((r) => r.signalCount > 0 && !r.error);

  if (companiesWithUpdates.length === 0) {
    console.log("[PIPELINE] No new signals across any company — skipping email");
  } else {
    console.log(
      "[PIPELINE] %d companies had new signals — sending digest emails",
      companiesWithUpdates.length,
    );

    // Gather all org IDs that track any of the updated companies
    const orgCompanyMap = new Map<string, CompanyPipelineResult[]>();

    for (const result of companiesWithUpdates) {
      const orgIds = await getTrackingOrgs(result.companyId);
      for (const orgId of orgIds) {
        if (!orgCompanyMap.has(orgId)) orgCompanyMap.set(orgId, []);
        orgCompanyMap.get(orgId)!.push(result);
      }
    }

    // Send one digest email per org
    for (const [orgId, orgResults] of orgCompanyMap) {
      const recipients = await getOrgRecipientEmails(orgId);
      if (recipients.length === 0) continue;

      const trackedCompanies = await getTrackedCompanies(orgId);
      const orgLastRun = trackedCompanies.reduce<string | null>(
        (earliest, trackedCompany) => {
          const originalCompany =
            companyMap.get(trackedCompany.company_id) ?? trackedCompany;
          if (!originalCompany.last_agent_run) return earliest;
          if (!earliest) return originalCompany.last_agent_run;
          return originalCompany.last_agent_run < earliest
            ? originalCompany.last_agent_run
            : earliest;
        },
        null,
      );

      // Build digest data: company + findings pairs
      const digestCompanies = orgResults.map((r) => ({
        company: companyMap.get(r.companyId)!,
        findings: r.findings,
      }));

      for (const recipient of recipients) {
        if (!shouldRunToday(recipient.emailFrequency, orgLastRun)) {
          console.log(
            "[PIPELINE] Skipping digest for %s (org %s, frequency %s, last run %s)",
            recipient.email,
            orgId,
            recipient.emailFrequency,
            orgLastRun ?? "never",
          );
          continue;
        }

        const sent = await sendDigestEmail(recipient.email, digestCompanies);
        if (sent) {
          console.log(
            "[PIPELINE] Digest email sent to %s (org %s, %d companies)",
            recipient.email,
            orgId,
            digestCompanies.length,
          );
        }
      }
    }
  }

  const elapsed = (Date.now() - pipelineStart) / 1000;
  console.log("[PIPELINE] Pipeline finished in %.1fs", elapsed);

  return {
    companiesProcessed: results.length,
    results,
    elapsed_seconds: Math.round(elapsed * 10) / 10,
  };
}
