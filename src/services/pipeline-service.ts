import { createAdminClient } from "@/lib/supabase/admin";
import { createHash } from "node:crypto";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import type {
  Company,
  SignalFinding,
  CompanyPipelineResult,
  SignalDefinition,
} from "@/lib/types";
import {
  updateLastAgentRun,
  getCompanyById,
} from "@/services/company-service";
import {
  buildAgentsFromDefinitions,
  runIntelligenceAgentsSilent,
} from "@/services/orchestrator";
import {
  generateReportFromFindings,
  getRecentReportForCompany,
  storeReport,
} from "@/services/report-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import { getTinyfishRun, queueTinyfishAgent } from "@/services/tinyfish-client";
import { scoreSignalFinding, classifyFreshness } from "@/services/signal-scoring";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

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
  const batchNormalized = new Set<string>();

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

    // Layer 1c: Normalized title match within batch (strip punctuation, collapse whitespace)
    const normalized = normalizeTitle(finding.title ?? "");
    if (normalized.length > 0 && batchNormalized.has(normalized)) {
      console.log(
        "[DEDUP] DUPLICATE — title: \"%s\" | reason: normalized title match in batch",
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
    if (normalized.length > 0) batchNormalized.add(normalized);
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
      .limit(50);
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
    priority_score: finding.priority_score ?? null,
    priority_tier: finding.priority_tier ?? null,
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

    // 5. Score and classify each finding (#23, #19)
    for (const f of finalFindings) {
      const { score, tier } = scoreSignalFinding(f);
      f.priority_score = score;
      f.priority_tier = tier;
      f.freshness_class = classifyFreshness(f.detected_at);
    }

    // 6. Store & report
    if (finalFindings.length > 0) {
      // Store ALL signals for history (#22)
      await storeSignals(company.company_id, finalFindings);
      console.log("%s Stored %d signals", tag, finalFindings.length);

      // Only digest-worthy signals enter the report (#22, #20)
      const digestFindings = finalFindings.filter(
        (f) => f.priority_tier !== "low" && f.freshness_class !== "stale",
      );

      if (digestFindings.length > 0) {
        const reportData = generateReportFromFindings(company, digestFindings, definitions);
        reportData.cache_context = {
          signal_definition_fingerprint: buildSignalDefinitionFingerprint(definitions),
        };
        const report = await storeReport(company.company_id, reportData, trigger);
        console.log("%s Report stored (%d sections, %d digest signals)", tag, reportData.sections.length, digestFindings.length);

        await updateLastAgentRun(company.company_id);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log("%s Done in %ss — %d new signals (%d digest-worthy)", tag, elapsed, finalFindings.length, digestFindings.length);

        return {
          companyId: company.company_id,
          companyName: company.company_name,
          signalCount: finalFindings.length,
          reportId: report.report_id,
          findings: finalFindings,
        };
      }

      // Signals stored but none digest-worthy
      await updateLastAgentRun(company.company_id);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log("%s Done in %ss — %d signals stored (none digest-worthy)", tag, elapsed, finalFindings.length);

      return {
        companyId: company.company_id,
        companyName: company.company_name,
        signalCount: finalFindings.length,
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

type CompanyPipelineRunStatus = "queued" | "running" | "completed" | "failed";
type CompanyAgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

interface CompanyPipelineRunRow {
  company_run_id: string;
  company_id: string;
  requested_source: "cron" | "manual" | "refresh";
  status: CompanyPipelineRunStatus;
  report_id: string | null;
  signal_count: number;
  error: string | null;
}

interface CompanyAgentRunRow {
  agent_run_id: string;
  company_run_id: string;
  company_id: string;
  agent_name: string;
  definition_id: string | null;
  tinyfish_run_id: string | null;
  status: CompanyAgentRunStatus;
  findings: unknown;
  error: unknown;
}

export interface SubmittedCompanyAgents {
  companyRunId: string;
  companyId: string;
  agentCount: number;
}

export interface PolledCompanyAgents {
  companyRunId: string;
  companyId: string;
  terminal: boolean;
  pendingCount: number;
  completedCount: number;
  failedCount: number;
}

export interface FinalizedCompanyRun {
  companyRunId: string;
  companyId: string;
  status: "completed" | "failed";
  signalCount: number;
  reportId?: string;
  error?: string;
}

export interface MaybeReusedCompanyRun {
  cacheHit: boolean;
  result?: FinalizedCompanyRun;
}

function toReportTrigger(source: "cron" | "manual" | "refresh"): "manual" | "cron" {
  return source === "cron" ? "cron" : "manual";
}

function getPipelineCacheTtlHours(): number {
  const parsed = Number(process.env.PIPELINE_CACHE_TTL_HOURS ?? "6");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
}

function buildSignalDefinitionFingerprint(
  definitions: SignalDefinition[],
): string {
  const normalized = [...definitions]
    .map((definition) => ({
      id: definition.id,
      company_id: definition.company_id ?? null,
      is_default: definition.is_default,
      name: definition.name,
      signal_type: definition.signal_type,
      display_name: definition.display_name,
      target_url: definition.target_url,
      search_instructions: definition.search_instructions,
      scope: definition.scope,
      enabled: definition.enabled,
      sort_order: definition.sort_order,
      created_at: definition.created_at ?? "",
      updated_at: definition.updated_at ?? "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function readAgentErrorMessage(error: unknown): string {
  if (!error) return "Unknown agent failure";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    if (
      "message" in error &&
      typeof (error as { message?: unknown }).message === "string"
    ) {
      return (error as { message: string }).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown agent failure";
    }
  }
  return String(error);
}

function parseTinyfishFindings(
  raw: unknown,
  definitionId?: string | null,
): { findings: SignalFinding[]; error?: string } {
  let parsed = raw;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (error) {
      return {
        findings: [],
        error: `Malformed TinyFish JSON result: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { findings: [] };
  }

  const maybeSignals = (parsed as { signals?: unknown }).signals;
  if (maybeSignals == null) {
    return { findings: [] };
  }

  if (!Array.isArray(maybeSignals)) {
    return {
      findings: [],
      error: "TinyFish result did not contain a signals array",
    };
  }

  const findings = maybeSignals.flatMap((value) => {
    if (!value || typeof value !== "object") return [];

    const record = value as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title : "";
    const summary = typeof record.summary === "string" ? record.summary : "";
    if (!title || !summary) return [];

    return [
      {
        signal_type:
          typeof record.signal_type === "string"
            ? record.signal_type
            : "general_news",
        title,
        summary,
        source: typeof record.source === "string" ? record.source : "unknown",
        url: typeof record.url === "string" ? record.url : undefined,
        detected_at:
          typeof record.detected_at === "string"
            ? record.detected_at
            : undefined,
        signal_definition_id:
          typeof record.signal_definition_id === "string"
            ? record.signal_definition_id
            : definitionId ?? undefined,
      } satisfies SignalFinding,
    ];
  });

  return { findings };
}

async function getCompanyPipelineRun(
  companyRunId: string,
): Promise<CompanyPipelineRunRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_pipeline_runs")
    .select(
      "company_run_id, company_id, requested_source, status, report_id, signal_count, error",
    )
    .eq("company_run_id", companyRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load company pipeline run: ${error.message}`);
  }

  return (data as CompanyPipelineRunRow | null) ?? null;
}

async function listCompanyAgentRuns(
  companyRunId: string,
): Promise<CompanyAgentRunRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_agent_runs")
    .select(
      "agent_run_id, company_run_id, company_id, agent_name, definition_id, tinyfish_run_id, status, findings, error",
    )
    .eq("company_run_id", companyRunId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load company agent runs: ${error.message}`);
  }

  return (data ?? []) as CompanyAgentRunRow[];
}

async function markCompanyRunState(
  companyRunId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("company_pipeline_runs")
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq("company_run_id", companyRunId);

  if (error) {
    throw new Error(`Failed to update company pipeline run: ${error.message}`);
  }
}

export async function failCompanyRun(
  companyRunId: string,
  errorMessage: string,
): Promise<FinalizedCompanyRun> {
  const companyRun = await getCompanyPipelineRun(companyRunId);
  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  if (companyRun.status === "completed" || companyRun.status === "failed") {
    return {
      companyRunId,
      companyId: companyRun.company_id,
      status: companyRun.status,
      signalCount: companyRun.signal_count,
      reportId: companyRun.report_id ?? undefined,
      error: companyRun.error ?? errorMessage,
    };
  }

  await markCompanyRunState(companyRunId, {
    status: "failed",
    signal_count: 0,
    report_id: null,
    error: errorMessage,
    completed_at: new Date().toISOString(),
  });

  return {
    companyRunId,
    companyId: companyRun.company_id,
    status: "failed",
    signalCount: 0,
    error: errorMessage,
  };
}

export async function maybeReuseRecentReport(
  companyRunId: string,
): Promise<MaybeReusedCompanyRun> {
  const companyRun = await getCompanyPipelineRun(companyRunId);
  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  if (companyRun.status === "completed" || companyRun.status === "failed") {
    return {
      cacheHit: false,
      result: {
        companyRunId,
        companyId: companyRun.company_id,
        status: companyRun.status,
        signalCount: companyRun.signal_count,
        reportId: companyRun.report_id ?? undefined,
        error: companyRun.error ?? undefined,
      },
    };
  }

  const definitions = await getSignalDefinitions(companyRun.company_id);
  const currentFingerprint = buildSignalDefinitionFingerprint(definitions);

  const recent = await getRecentReportForCompany(
    companyRun.company_id,
    getPipelineCacheTtlHours(),
  );
  if (!recent) {
    return { cacheHit: false };
  }

  const cachedFingerprint =
    recent.report.report_data.cache_context?.signal_definition_fingerprint;
  if (cachedFingerprint !== currentFingerprint) {
    return { cacheHit: false };
  }

  await markCompanyRunState(companyRunId, {
    status: "completed",
    report_id: recent.report.report_id,
    signal_count: recent.signalCount,
    error: null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  console.log(
    "[PIPELINE] [CACHE HIT] Reused report %s for company %s",
    recent.report.report_id,
    companyRun.company_id,
  );

  return {
    cacheHit: true,
    result: {
      companyRunId,
      companyId: companyRun.company_id,
      status: "completed",
      signalCount: recent.signalCount,
      reportId: recent.report.report_id,
    },
  };
}

async function persistCompanyFindings(
  company: Company,
  definitions: SignalDefinition[],
  trigger: "manual" | "cron",
  findings: SignalFinding[],
): Promise<CompanyPipelineResult> {
  const tag = `[PIPELINE] [${company.company_name}]`;

  const newFindings = await deduplicateFindings(company.company_id, findings);
  console.log(
    "%s After fast dedup: %d new signals (filtered %d duplicates)",
    tag,
    newFindings.length,
    findings.length - newFindings.length,
  );

  const finalFindings = await llmDedup(company.company_id, newFindings);
  console.log(
    "%s After LLM dedup: %d signals (filtered %d more)",
    tag,
    finalFindings.length,
    newFindings.length - finalFindings.length,
  );

  // Score and classify each finding (#23, #19)
  for (const f of finalFindings) {
    const { score, tier } = scoreSignalFinding(f);
    f.priority_score = score;
    f.priority_tier = tier;
    f.freshness_class = classifyFreshness(f.detected_at);
  }

  if (finalFindings.length > 0) {
    // Store ALL signals for history (#22)
    await storeSignals(company.company_id, finalFindings);
    console.log("%s Stored %d signals", tag, finalFindings.length);

    // Only digest-worthy signals enter the report (#22, #20)
    const digestFindings = finalFindings.filter(
      (f) => f.priority_tier !== "low" && f.freshness_class !== "stale",
    );
    console.log("%s Digest-worthy: %d (filtered %d low/stale)", tag, digestFindings.length, finalFindings.length - digestFindings.length);

    if (digestFindings.length > 0) {
      const reportData = generateReportFromFindings(company, digestFindings, definitions);
      reportData.cache_context = {
        signal_definition_fingerprint: buildSignalDefinitionFingerprint(definitions),
      };
      const report = await storeReport(company.company_id, reportData, trigger);
      console.log("%s Report stored (%d sections)", tag, reportData.sections.length);

      await updateLastAgentRun(company.company_id);

      return {
        companyId: company.company_id,
        companyName: company.company_name,
        signalCount: digestFindings.length,
        reportId: report.report_id,
        findings: digestFindings,
      };
    }

    // Signals stored but none were digest-worthy
    await updateLastAgentRun(company.company_id);
    return {
      companyId: company.company_id,
      companyName: company.company_name,
      signalCount: 0,
      findings: [],
    };
  }

  await updateLastAgentRun(company.company_id);

  return {
    companyId: company.company_id,
    companyName: company.company_name,
    signalCount: 0,
    findings: [],
  };
}

export async function submitCompanyAgents(
  companyRunId: string,
): Promise<SubmittedCompanyAgents> {
  const companyRun = await getCompanyPipelineRun(companyRunId);
  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  if (companyRun.status === "queued") {
    const now = new Date().toISOString();
    await markCompanyRunState(companyRunId, {
      status: "running",
      started_at: now,
    });

    const supabase = createAdminClient();
    const { error: requestCompanyError } = await supabase
      .from("pipeline_request_companies")
      .update({
        status: "running",
        updated_at: now,
      })
      .eq("company_run_id", companyRunId)
      .eq("status", "queued");

    if (requestCompanyError) {
      throw new Error(
        `Failed to mark request companies running: ${requestCompanyError.message}`,
      );
    }
  }

  const company = await getCompanyById(companyRun.company_id);
  if (!company) {
    await markCompanyRunState(companyRunId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: `Company ${companyRun.company_id} not found`,
    });

    return {
      companyRunId,
      companyId: companyRun.company_id,
      agentCount: 0,
    };
  }

  const definitions = await getSignalDefinitions(company.company_id);
  const enabledDefinitions = definitions.filter((definition) => definition.enabled);
  const agents = buildAgentsFromDefinitions(company, enabledDefinitions);
  const existingRuns = await listCompanyAgentRuns(companyRunId);
  const existingDefinitionIds = new Set(
    existingRuns
      .map((run) => run.definition_id)
      .filter((definitionId): definitionId is string => !!definitionId),
  );

  const agentsToSubmit = agents.filter(
    (agent) => !existingDefinitionIds.has(agent.definitionId),
  );

  const supabase = createAdminClient();
  await Promise.all(
    agentsToSubmit.map(async (agent) => {
      const queued = await queueTinyfishAgent({ url: agent.url, goal: agent.goal });
      const payload = {
        company_run_id: companyRunId,
        company_id: company.company_id,
        agent_name: agent.name,
        definition_id: agent.definitionId,
        tinyfish_run_id: queued.run_id,
        status: queued.status,
        error: queued.error,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("company_agent_runs").insert(payload);
      if (error) {
        throw new Error(`Failed to create company agent run: ${error.message}`);
      }
    }),
  );

  return {
    companyRunId,
    companyId: company.company_id,
    agentCount: agents.length,
  };
}

export async function pollCompanyAgents(
  companyRunId: string,
): Promise<PolledCompanyAgents> {
  const companyRun = await getCompanyPipelineRun(companyRunId);
  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  const supabase = createAdminClient();
  const agentRuns = await listCompanyAgentRuns(companyRunId);

  await Promise.all(
    agentRuns.map(async (agentRun) => {
      if (agentRun.status === "completed" || agentRun.status === "failed" || agentRun.status === "canceled") {
        return;
      }

      if (!agentRun.tinyfish_run_id) {
        const { error } = await supabase
          .from("company_agent_runs")
          .update({
            status: "failed",
            error: { code: "MISSING_RUN_ID", message: "TinyFish run ID is missing" },
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("agent_run_id", agentRun.agent_run_id);

        if (error) {
          throw new Error(`Failed to mark missing TinyFish run ID: ${error.message}`);
        }
        return;
      }

      let status;
      try {
        status = await getTinyfishRun(agentRun.tinyfish_run_id);
      } catch (error) {
        console.warn(
          "[PIPELINE] Failed to poll TinyFish run %s: %s",
          agentRun.tinyfish_run_id,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }

      const nextStatus = status.status;
      if (nextStatus === "completed") {
        const parsed = parseTinyfishFindings(status.result, agentRun.definition_id);
        if (parsed.error) {
          const { error } = await supabase
            .from("company_agent_runs")
            .update({
              status: "failed",
              error: { code: "MALFORMED_RESULT", message: parsed.error },
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("agent_run_id", agentRun.agent_run_id);

          if (error) {
            throw new Error(`Failed to persist malformed TinyFish result: ${error.message}`);
          }
          return;
        }

        const { error } = await supabase
          .from("company_agent_runs")
          .update({
            status: "completed",
            findings: parsed.findings,
            error: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("agent_run_id", agentRun.agent_run_id);

        if (error) {
          throw new Error(`Failed to persist completed TinyFish run: ${error.message}`);
        }
        return;
      }

      if (nextStatus === "failed" || nextStatus === "canceled") {
        const { error } = await supabase
          .from("company_agent_runs")
          .update({
            status: nextStatus,
            error: status.error,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("agent_run_id", agentRun.agent_run_id);

        if (error) {
          throw new Error(`Failed to persist failed TinyFish run: ${error.message}`);
        }
        return;
      }

      const { error } = await supabase
        .from("company_agent_runs")
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("agent_run_id", agentRun.agent_run_id);

      if (error) {
        throw new Error(`Failed to persist TinyFish run status: ${error.message}`);
      }
    }),
  );

  const refreshedRuns = await listCompanyAgentRuns(companyRunId);
  const pendingCount = refreshedRuns.filter(
    (run) => run.status === "queued" || run.status === "running",
  ).length;
  const completedCount = refreshedRuns.filter((run) => run.status === "completed").length;
  const failedCount = refreshedRuns.filter(
    (run) => run.status === "failed" || run.status === "canceled",
  ).length;

  return {
    companyRunId,
    companyId: companyRun.company_id,
    terminal: pendingCount === 0,
    pendingCount,
    completedCount,
    failedCount,
  };
}

export async function finalizeCompanyAgents(
  companyRunId: string,
): Promise<FinalizedCompanyRun> {
  const companyRun = await getCompanyPipelineRun(companyRunId);
  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  const company = await getCompanyById(companyRun.company_id);
  if (!company) {
    const errorMessage = `Company ${companyRun.company_id} not found`;
    await markCompanyRunState(companyRunId, {
      status: "failed",
      completed_at: new Date().toISOString(),
      error: errorMessage,
    });

    return {
      companyRunId,
      companyId: companyRun.company_id,
      status: "failed",
      signalCount: 0,
      error: errorMessage,
    };
  }

  const agentRuns = await listCompanyAgentRuns(companyRunId);
  const pendingCount = agentRuns.filter(
    (run) => run.status === "queued" || run.status === "running",
  ).length;

  if (pendingCount > 0) {
    throw new Error(`Company run ${companyRunId} still has ${pendingCount} active agent runs`);
  }

  const definitions = await getSignalDefinitions(company.company_id);
  const completedRuns = agentRuns.filter((run) => run.status === "completed");
  const failedRuns = agentRuns.filter(
    (run) => run.status === "failed" || run.status === "canceled",
  );
  const findings = completedRuns.flatMap((run) =>
    Array.isArray(run.findings) ? (run.findings as SignalFinding[]) : [],
  );

  if (completedRuns.length > 0 || agentRuns.length === 0) {
    const result = await persistCompanyFindings(
      company,
      definitions,
      toReportTrigger(companyRun.requested_source),
      findings,
    );

    await markCompanyRunState(companyRunId, {
      status: "completed",
      report_id: result.reportId ?? null,
      signal_count: result.signalCount,
      error: null,
      completed_at: new Date().toISOString(),
    });

    return {
      companyRunId,
      companyId: company.company_id,
      status: "completed",
      signalCount: result.signalCount,
      reportId: result.reportId,
    };
  }

  const errorMessage =
    failedRuns
      .map((run) => readAgentErrorMessage(run.error))
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ") || "All TinyFish agent runs failed";

  await markCompanyRunState(companyRunId, {
    status: "failed",
    signal_count: 0,
    report_id: null,
    error: errorMessage,
    completed_at: new Date().toISOString(),
  });

  return {
    companyRunId,
    companyId: company.company_id,
    status: "failed",
    signalCount: 0,
    error: errorMessage,
  };
}
