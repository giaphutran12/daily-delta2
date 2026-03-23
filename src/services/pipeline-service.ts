import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Company, SignalFinding, PipelineResult, CompanyPipelineResult } from "@/lib/types";
import {
  getTrackedActiveCompanies,
  getCompanyById,
  getTrackingOrgs,
  updateLastAgentRun,
} from "@/services/company-service";
import { sendReportEmail } from "@/services/email-service";
import { runIntelligenceAgentsSilent } from "@/services/orchestrator";
import {
  generateReportFromFindings,
  storeReport,
} from "@/services/report-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import { getOrganizationMembers } from "@/services/organization-service";
import { getUserEmail } from "@/services/user-service";

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
 * One SQL query per finding — no bulk loading.
 *
 * - Has date: check title (case-insensitive) + date match
 * - No date: check title (case-insensitive) + detected_at IS NULL
 *
 * Also deduplicates within the current batch.
 */
async function deduplicateFindings(
  companyId: string,
  findings: SignalFinding[],
): Promise<SignalFinding[]> {
  if (findings.length === 0) return findings;

  const supabase = createAdminClient();
  const newFindings: SignalFinding[] = [];

  // Track what we've already accepted this batch (title|date or title|null)
  const batchKeys = new Set<string>();

  for (const finding of findings) {
    const title = (finding.title ?? "").trim();
    const titleLower = title.toLowerCase();
    const date = sanitizeTimestamp(finding.detected_at);
    const dateDay = date ? new Date(date).toISOString().slice(0, 10) : null;
    const batchKey = `${titleLower}|${dateDay ?? "null"}`;

    // Check within current batch first
    if (batchKeys.has(batchKey)) {
      console.log(
        "[DEDUP] DUPLICATE — title: \"%s\" | date: %s | reason: duplicate within same batch",
        finding.title, dateDay ?? "(no date)",
      );
      continue;
    }

    // Check against database
    let query = supabase
      .from("signals")
      .select("signal_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .ilike("title", titleLower);

    if (dateDay) {
      // Has a real date — match title + same day
      query = query.gte("detected_at", `${dateDay}T00:00:00.000Z`)
                   .lt("detected_at", `${dateDay}T23:59:59.999Z`);
    } else {
      // No date — match title + detected_at is null
      query = query.is("detected_at", null);
    }

    const { count, error } = await query;

    if (error) {
      console.warn("[DEDUP] Query failed for \"%s\", keeping signal: %s", finding.title, error.message);
      newFindings.push(finding);
      batchKeys.add(batchKey);
      continue;
    }

    if ((count ?? 0) > 0) {
      console.log(
        "[DEDUP] DUPLICATE — title: \"%s\" | date: %s | reason: exists in DB",
        finding.title, dateDay ?? "(no date)",
      );
    } else {
      // Check if same URL already exists
      if (finding.url) {
        const { count: urlCount } = await supabase
          .from("signals")
          .select("signal_id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("url", finding.url);

        if ((urlCount ?? 0) > 0) {
          // Count path segments to decide if this is a deep/specific URL
          let pathDepth = 0;
          try {
            pathDepth = new URL(finding.url).pathname.split("/").filter(Boolean).length;
          } catch {}

          if (pathDepth >= 3) {
            // Deep URL (e.g. /blog/2026/billing-v3) — specific enough to dedup
            console.log(
              "[DEDUP] DUPLICATE — title: \"%s\" | url: %s | reason: deep URL match (depth %d)",
              finding.title, finding.url, pathDepth,
            );
            continue;
          } else {
            // Shallow URL (e.g. /careers, /blog) — too generic, just log it
            console.log(
              "[DEDUP] URL MATCH (not deduped, shallow path depth %d) — title: \"%s\" | url: %s",
              pathDepth, finding.title, finding.url,
            );
          }
        }
      }

      console.log(
        "[DEDUP] NEW — title: \"%s\" | date: %s | signal_type: %s",
        finding.title, dateDay ?? "(no date)", finding.signal_type,
      );
      newFindings.push(finding);
      batchKeys.add(batchKey);
    }
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
      const existing = existingByType.get(finding.signal_type) ?? [];

      // Nothing to compare against — keep it
      if (existing.length === 0) {
        console.log(
          "[DEDUP-LLM] SKIP (no existing signals of type %s) — title: \"%s\"",
          finding.signal_type, finding.title,
        );
        return { finding, keep: true };
      }

      // Build the comparison list
      const existingList = existing
        .map((s, i) => `${i + 1}. "${s.title}" — ${s.content?.slice(0, 100) ?? ""} (source: ${s.source})`)
        .join("\n");

      const prompt = `You are a deduplication checker. Determine if the NEW signal below is a duplicate of any EXISTING signal. Two signals are duplicates if they describe the same event, announcement, or fact — even if worded differently.

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
): Promise<string[]> {
  const members = await getOrganizationMembers(organizationId);
  const activeMembers = members.filter(
    (m): m is typeof m & { user_id: string } => m.user_id !== null,
  );

  const emails = await Promise.all(
    activeMembers.map(async (member) => {
      const email = await getUserEmail(member.user_id);
      return email || member.email || null;
    }),
  );

  return emails.filter((e): e is string => e !== null);
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
    await storeSignals(company.company_id, finalFindings);
    await updateLastAgentRun(company.company_id);
    console.log("%s Stored %d signals", tag, finalFindings.length);

    // 6. Generate & store report from new findings
    const reportData = generateReportFromFindings(company, finalFindings, definitions);
    const report = await storeReport(company.company_id, reportData, "cron");
    console.log("%s Report stored (%d sections)", tag, reportData.sections.length);

    // 7. Email to all orgs tracking this company
    const trackingOrgIds = await getTrackingOrgs(company.company_id);
    let totalEmailsSent = 0;

    for (const orgId of trackingOrgIds) {
      const emails = await getOrgRecipientEmails(orgId);

      for (const email of emails) {
        const sent = await sendReportEmail(email, company, reportData);
        if (sent) {
          console.log("%s Email sent to %s (org %s)", tag, email, orgId);
          totalEmailsSent += 1;
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      "%s Done in %ss — %d findings, %d emails sent",
      tag,
      elapsed,
      findings.length,
      totalEmailsSent,
    );

    return {
      companyId: company.company_id,
      companyName: company.company_name,
      signalCount: findings.length,
      reportId: report.report_id,
      emailsSent: totalEmailsSent,
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
      emailsSent: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Run full pipeline (all tracked companies)
// ---------------------------------------------------------------------------

export async function runPipeline(
  singleCompanyId?: string,
): Promise<PipelineResult> {
  const pipelineStart = Date.now();

  let companies: Company[];

  if (singleCompanyId) {
    const company = await getCompanyById(singleCompanyId);
    if (!company) throw new Error(`Company ${singleCompanyId} not found`);
    companies = [company];
  } else {
    companies = await getTrackedActiveCompanies();
  }

  if (companies.length === 0) {
    console.log("[PIPELINE] No tracked active companies to process");
    return { companiesProcessed: 0, results: [], elapsed_seconds: 0 };
  }

  console.log("[PIPELINE] Processing %d companies", companies.length);

  const results: CompanyPipelineResult[] = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((company) => processCompany(company)),
    );
    results.push(...batchResults);
  }

  const elapsed = (Date.now() - pipelineStart) / 1000;
  console.log("[PIPELINE] Pipeline finished in %.1fs", elapsed);

  return {
    companiesProcessed: results.length,
    results,
    elapsed_seconds: Math.round(elapsed * 10) / 10,
  };
}
