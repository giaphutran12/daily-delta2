import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type { Company, SignalFinding, CompanyPipelineResult } from "@/lib/types";
import {
  updateLastAgentRun,
} from "@/services/company-service";
import { runIntelligenceAgentsSilent } from "@/services/orchestrator";
import {
  generateReportFromFindings,
  storeReport,
} from "@/services/report-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";

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

export async function processCompany(
  company: Company,
  trigger: "manual" | "cron" = "cron",
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
      const report = await storeReport(company.company_id, reportData, trigger);
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
