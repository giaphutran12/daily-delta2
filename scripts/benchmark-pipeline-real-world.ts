#!/usr/bin/env npx tsx

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Company, SignalDefinition } from "../src/lib/types";
import {
  getCompaniesByIds,
  getTrackedActiveCompanies,
} from "../src/services/company-service";
import { resolveTemplate } from "../src/lib/utils/template";
import {
  analyzeCompanyWithMode,
  type CompanyPipelineAnalysis,
} from "../src/services/pipeline-service";
import { classifyFreshness } from "../src/services/signal-scoring";
import { getSignalDefinitions } from "../src/services/signal-definition-service";

interface Args {
  companyIds: string[];
  freshTarget: number;
  quietTarget: number;
  preflightFreshPool: number;
  preflightQuietPool: number;
  historyDays: number;
  concurrency: number;
  definitionMode: "deterministic" | "all";
  maxCompanyMs: number;
  outputPath?: string;
}

interface HistoryRow {
  company_id: string;
  detected_at: string | null;
  created_at: string;
  priority_tier: "high" | "medium" | "low" | null;
}

interface CompanyHistorySummary {
  recentSignalCount: number;
  recentDigestCount: number;
  recentFreshHighCount: number;
  recentLowOrStaleCount: number;
  latestSignalAt: string | null;
}

interface BenchmarkCandidate {
  company: Company;
  definitions: SignalDefinition[];
  history: CompanyHistorySummary;
}

interface SelectedCompany {
  company: Company;
  definitions: SignalDefinition[];
  history: CompanyHistorySummary;
  fetchPreflight: CompanyPipelineAnalysis;
  selectionBucket: "fresh" | "quiet" | "fill";
}

function timeoutAnalysis(
  mode: CompanyPipelineAnalysis["mode"],
  company: Company,
  durationMs: number,
  error: string,
): CompanyPipelineAnalysis {
  return {
    mode,
    companyId: company.company_id,
    companyName: company.company_name,
    durationMs,
    rawFindingCount: 0,
    newFindingCount: 0,
    finalFindingCount: 0,
    digestFindingCount: 0,
    highFreshCount: 0,
    canaryCaptured: false,
    findings: [],
    digestFindings: [],
    error,
  };
}

function usage(): string {
  return [
    "Usage:",
    "  npx tsx scripts/benchmark-pipeline-real-world.ts [options]",
    "",
    "Options:",
    "  --company-id <uuid>           Benchmark explicit companies only (repeatable)",
    "  --fresh-target <n>            Fresh/new companies to include (default: 3)",
    "  --quiet-target <n>            Quiet/low-signal companies to include (default: 2)",
    "  --preflight-fresh-pool <n>    Fresh-history companies to preflight (default: 4)",
    "  --preflight-quiet-pool <n>    Quiet-history companies to preflight (default: 4)",
    "  --history-days <n>            Signal history lookback window (default: 45)",
    "  --concurrency <n>             Companies in parallel per mode (default: 2)",
    "  --definition-mode <mode>      deterministic or all (default: deterministic)",
    "  --max-company-ms <n>          Hard timeout per company/mode (default: 180000)",
    "  --output <path>               Custom markdown output path",
    "  --help                        Show this help text",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    companyIds: [],
    freshTarget: 3,
    quietTarget: 2,
    preflightFreshPool: 4,
    preflightQuietPool: 4,
    historyDays: 45,
    concurrency: 2,
    definitionMode: "deterministic",
    maxCompanyMs: 180_000,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--company-id":
        args.companyIds.push(argv[++i] ?? "");
        break;
      case "--fresh-target":
        args.freshTarget = Number(argv[++i] ?? "");
        break;
      case "--quiet-target":
        args.quietTarget = Number(argv[++i] ?? "");
        break;
      case "--preflight-fresh-pool":
        args.preflightFreshPool = Number(argv[++i] ?? "");
        break;
      case "--preflight-quiet-pool":
        args.preflightQuietPool = Number(argv[++i] ?? "");
        break;
      case "--history-days":
        args.historyDays = Number(argv[++i] ?? "");
        break;
      case "--concurrency":
        args.concurrency = Number(argv[++i] ?? "");
        break;
      case "--definition-mode": {
        const value = (argv[++i] ?? "").toLowerCase();
        if (value !== "deterministic" && value !== "all") {
          throw new Error("--definition-mode must be deterministic or all.");
        }
        args.definitionMode = value;
        break;
      }
      case "--max-company-ms":
        args.maxCompanyMs = Number(argv[++i] ?? "");
        break;
      case "--output":
        args.outputPath = argv[++i] ?? "";
        break;
      case "--help":
        console.log(usage());
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }

  if (!Number.isFinite(args.freshTarget) || args.freshTarget < 0) {
    throw new Error("--fresh-target must be a non-negative integer.");
  }
  if (!Number.isFinite(args.quietTarget) || args.quietTarget < 0) {
    throw new Error("--quiet-target must be a non-negative integer.");
  }
  if (!Number.isFinite(args.preflightFreshPool) || args.preflightFreshPool < 1) {
    throw new Error("--preflight-fresh-pool must be a positive integer.");
  }
  if (!Number.isFinite(args.preflightQuietPool) || args.preflightQuietPool < 1) {
    throw new Error("--preflight-quiet-pool must be a positive integer.");
  }
  if (!Number.isFinite(args.historyDays) || args.historyDays < 1) {
    throw new Error("--history-days must be a positive integer.");
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  if (!Number.isFinite(args.maxCompanyMs) || args.maxCompanyMs < 1_000) {
    throw new Error("--max-company-ms must be at least 1000.");
  }

  args.freshTarget = Math.floor(args.freshTarget);
  args.quietTarget = Math.floor(args.quietTarget);
  args.preflightFreshPool = Math.floor(args.preflightFreshPool);
  args.preflightQuietPool = Math.floor(args.preflightQuietPool);
  args.historyDays = Math.floor(args.historyDays);
  args.concurrency = Math.floor(args.concurrency);
  args.maxCompanyMs = Math.floor(args.maxCompanyMs);

  return args;
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${ms}ms`;
}

function compareIsoDesc(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

function dedupeByCompanyId<T extends { company: Company }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.company.company_id)) continue;
    seen.add(item.company.company_id);
    result.push(item);
  }
  return result;
}

const SEARCH_ENGINE_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "news.google.com",
  "techcrunch.com",
  "www.techcrunch.com",
  "github.com",
  "www.github.com",
  "trends.google.com",
]);

function isSearchBasedDefinition(targetUrl: string): boolean {
  try {
    const host = new URL(targetUrl).hostname;
    return SEARCH_ENGINE_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function withTimeout<T>(
  label: string,
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  return Promise.race([
    work(),
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function findingPreview(result: CompanyPipelineAnalysis, limit = 2): string {
  if (result.error) return result.error;
  if (result.findings.length === 0) return "none";
  return result.findings
    .slice(0, limit)
    .map((finding) => {
      const tier = finding.priority_tier ?? "n/a";
      const freshness = finding.freshness_class ?? "n/a";
      return `${finding.title} (${tier}, ${freshness})`;
    })
    .join(" ; ")
    .replace(/\|/g, "/");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function loadHistory(
  companyIds: string[],
  historyDays: number,
): Promise<Map<string, CompanyHistorySummary>> {
  const supabase = createAdminClient();
  const sinceIso = new Date(
    Date.now() - historyDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("signals")
    .select("company_id, detected_at, created_at, priority_tier")
    .in("company_id", companyIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load signal history: ${error.message}`);
  }

  const map = new Map<string, CompanyHistorySummary>();
  for (const companyId of companyIds) {
    map.set(companyId, {
      recentSignalCount: 0,
      recentDigestCount: 0,
      recentFreshHighCount: 0,
      recentLowOrStaleCount: 0,
      latestSignalAt: null,
    });
  }

  for (const row of (data ?? []) as HistoryRow[]) {
    const summary = map.get(row.company_id);
    if (!summary) continue;

    const freshness = classifyFreshness(row.detected_at ?? undefined, row.created_at);
    summary.recentSignalCount += 1;
    if (row.priority_tier !== "low" && freshness !== "stale") {
      summary.recentDigestCount += 1;
    }
    if (row.priority_tier === "high" && freshness === "fresh") {
      summary.recentFreshHighCount += 1;
    }
    if (row.priority_tier === "low" || freshness === "stale") {
      summary.recentLowOrStaleCount += 1;
    }
    if (!summary.latestSignalAt || row.created_at > summary.latestSignalAt) {
      summary.latestSignalAt = row.created_at;
    }
  }

  return map;
}

async function loadCandidates(args: Args): Promise<BenchmarkCandidate[]> {
  const companies =
    args.companyIds.length > 0
      ? await getCompaniesByIds([...new Set(args.companyIds.filter(Boolean))])
      : await getTrackedActiveCompanies();

  if (companies.length === 0) {
    throw new Error("No companies matched the requested scope.");
  }

  const historyByCompanyId = await loadHistory(
    companies.map((company) => company.company_id),
    args.historyDays,
  );

  const withDefinitions = await Promise.all(
    companies.map(async (company) => {
      const definitions = (await getSignalDefinitions(company.company_id)).filter((definition) => {
        if (!definition.enabled) return false;
        if (args.definitionMode === "all") return true;
        return !isSearchBasedDefinition(resolveTemplate(definition.target_url, company));
      });
      return {
        company,
        definitions,
        history:
          historyByCompanyId.get(company.company_id) ?? {
            recentSignalCount: 0,
            recentDigestCount: 0,
            recentFreshHighCount: 0,
            recentLowOrStaleCount: 0,
            latestSignalAt: null,
          },
      };
    }),
  );

  return withDefinitions.filter((candidate) => candidate.definitions.length > 0);
}

function pickPreflightCandidates(
  candidates: BenchmarkCandidate[],
  args: Args,
): BenchmarkCandidate[] {
  if (args.companyIds.length > 0) {
    return candidates;
  }

  const freshPool = [...candidates]
    .sort((a, b) => {
      return (
        b.history.recentFreshHighCount - a.history.recentFreshHighCount ||
        b.history.recentDigestCount - a.history.recentDigestCount ||
        compareIsoDesc(a.history.latestSignalAt, b.history.latestSignalAt)
      );
    })
    .slice(0, args.preflightFreshPool);

  const quietPool = [...candidates]
    .sort((a, b) => {
      return (
        b.history.recentLowOrStaleCount - a.history.recentLowOrStaleCount ||
        a.history.recentFreshHighCount - b.history.recentFreshHighCount ||
        a.history.recentDigestCount - b.history.recentDigestCount ||
        compareIsoDesc(a.history.latestSignalAt, b.history.latestSignalAt)
      );
    })
    .slice(0, args.preflightQuietPool);

  return dedupeByCompanyId([...freshPool, ...quietPool]);
}

function selectCompanies(
  preflightResults: Array<SelectedCompany>,
  args: Args,
): SelectedCompany[] {
  const selected: SelectedCompany[] = [];

  const fresh = preflightResults
    .filter(
      (candidate) =>
        !candidate.fetchPreflight.error &&
        candidate.fetchPreflight.finalFindingCount > 0,
    )
    .sort((a, b) => {
      return (
        b.fetchPreflight.highFreshCount - a.fetchPreflight.highFreshCount ||
        b.fetchPreflight.digestFindingCount - a.fetchPreflight.digestFindingCount ||
        b.fetchPreflight.finalFindingCount - a.fetchPreflight.finalFindingCount ||
        a.fetchPreflight.durationMs - b.fetchPreflight.durationMs
      );
    });

  for (const candidate of fresh) {
    if (selected.length >= args.freshTarget) break;
    selected.push({ ...candidate, selectionBucket: "fresh" });
  }

  const quiet = preflightResults
    .filter(
      (candidate) =>
        !candidate.fetchPreflight.error &&
        candidate.fetchPreflight.digestFindingCount === 0,
    )
    .sort((a, b) => {
      return (
        a.fetchPreflight.finalFindingCount - b.fetchPreflight.finalFindingCount ||
        a.fetchPreflight.highFreshCount - b.fetchPreflight.highFreshCount ||
        b.history.recentLowOrStaleCount - a.history.recentLowOrStaleCount
      );
    });

  for (const candidate of quiet) {
    if (
      selected.filter((item) => item.selectionBucket === "quiet").length >=
      args.quietTarget
    ) {
      break;
    }
    if (selected.some((item) => item.company.company_id === candidate.company.company_id)) {
      continue;
    }
    selected.push({ ...candidate, selectionBucket: "quiet" });
  }

  const totalTarget = args.freshTarget + args.quietTarget;
  if (selected.length < totalTarget) {
    const fill = [...preflightResults].sort((a, b) => {
      return (
        b.fetchPreflight.finalFindingCount - a.fetchPreflight.finalFindingCount ||
        b.fetchPreflight.digestFindingCount - a.fetchPreflight.digestFindingCount ||
        a.fetchPreflight.durationMs - b.fetchPreflight.durationMs
      );
    });

    for (const candidate of fill) {
      if (selected.length >= totalTarget) break;
      if (selected.some((item) => item.company.company_id === candidate.company.company_id)) {
        continue;
      }
      selected.push({ ...candidate, selectionBucket: "fill" });
    }
  }

  return selected;
}

function buildMarkdownReport(input: {
  args: Args;
  preflightCandidates: BenchmarkCandidate[];
  selectedCompanies: SelectedCompany[];
  finalResults: CompanyPipelineAnalysis[];
}): string {
  const { args, preflightCandidates, selectedCompanies, finalResults } = input;
  const modeOrder: Array<CompanyPipelineAnalysis["mode"]> = [
    "search_fetch_extract",
    "legacy_tinyfish_agents",
  ];

  const lines: string[] = [
    "# Real-World Pipeline Benchmark",
    "",
    `Run at: ${new Date().toISOString()}`,
    `History lookback: ${args.historyDays} days`,
    `Definition mode: ${args.definitionMode}`,
    `Per-company timeout: ${formatMs(args.maxCompanyMs)}`,
    `Preflight candidates: ${preflightCandidates.length}`,
    `Selected companies: ${selectedCompanies.length}`,
    "",
    "## Selected Set",
    "",
    "| Company | Bucket | Enabled Definitions | Recent Fresh High | Recent Digest | Recent Low/Stale | Fetch New | Fetch Digest | Fetch Canary |",
    "|---------|--------|---------------------|-------------------|---------------|------------------|-----------|--------------|--------------|",
  ];

  for (const selected of selectedCompanies) {
    lines.push(
      `| ${selected.company.company_name} | ${selected.selectionBucket} | ${selected.definitions.length} | ${selected.history.recentFreshHighCount} | ${selected.history.recentDigestCount} | ${selected.history.recentLowOrStaleCount} | ${selected.fetchPreflight.finalFindingCount} | ${selected.fetchPreflight.digestFindingCount} | ${selected.fetchPreflight.canaryCaptured ? "YES" : "NO"} |`,
    );
  }

  lines.push(
    "",
    "## Mode Summary",
    "",
    "| Mode | Companies | Total Runtime | Avg Runtime | New Findings | Digest Findings | Canary Companies | Failures |",
    "|------|-----------|---------------|-------------|--------------|-----------------|------------------|----------|",
  );

  for (const mode of modeOrder) {
    const modeResults = finalResults.filter((result) => result.mode === mode);
    const totalRuntime = modeResults.reduce(
      (sum, result) => sum + result.durationMs,
      0,
    );
    const totalNew = modeResults.reduce(
      (sum, result) => sum + result.finalFindingCount,
      0,
    );
    const totalDigest = modeResults.reduce(
      (sum, result) => sum + result.digestFindingCount,
      0,
    );
    const canaries = modeResults.filter((result) => result.canaryCaptured).length;
    const failures = modeResults.filter((result) => !!result.error).length;
    const avgRuntime =
      modeResults.length > 0 ? formatMs(totalRuntime / modeResults.length) : "0ms";

    lines.push(
      `| ${mode} | ${modeResults.length} | ${formatMs(totalRuntime)} | ${avgRuntime} | ${totalNew} | ${totalDigest} | ${canaries}/${modeResults.length} | ${failures} |`,
    );
  }

  lines.push(
    "",
    "## Per Company",
    "",
    "| Company | Mode | Runtime | Raw | New | Digest | Canary | Notes |",
    "|---------|------|---------|-----|-----|--------|--------|-------|",
  );

  for (const result of finalResults) {
    lines.push(
      `| ${result.companyName} | ${result.mode} | ${formatMs(result.durationMs)} | ${result.rawFindingCount} | ${result.finalFindingCount} | ${result.digestFindingCount} | ${result.canaryCaptured ? "PASS" : "FAIL"} | ${findingPreview(result)} |`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const candidates = await loadCandidates(args);
  if (candidates.length === 0) {
    throw new Error("No benchmark candidates had enabled signal definitions.");
  }

  const preflightCandidates = pickPreflightCandidates(candidates, args);
  console.log(
    "[REAL-BENCH] Preflighting %d candidate companies with search_fetch_extract",
    preflightCandidates.length,
  );

  const preflightResults = await mapWithConcurrency(
    preflightCandidates,
    args.concurrency,
    async (candidate) => {
      const analysis = await withTimeout(
        `${candidate.company.company_name}/search_fetch_extract`,
        args.maxCompanyMs,
        () =>
          analyzeCompanyWithMode(
            "search_fetch_extract",
            candidate.company,
            candidate.definitions,
          ),
      ).catch((error) =>
        timeoutAnalysis(
          "search_fetch_extract",
          candidate.company,
          args.maxCompanyMs,
          error instanceof Error ? error.message : String(error),
        ),
      );
      return {
        company: candidate.company,
        definitions: candidate.definitions,
        history: candidate.history,
        fetchPreflight: analysis,
        selectionBucket: "fill" as const,
      };
    },
  );

  const selectedCompanies = selectCompanies(preflightResults, args);
  if (selectedCompanies.length === 0) {
    throw new Error("Preflight did not produce any benchmarkable companies.");
  }

  console.log(
    "[REAL-BENCH] Selected %d companies for final benchmark",
    selectedCompanies.length,
  );

  const legacyResults = await mapWithConcurrency(
    selectedCompanies,
    args.concurrency,
    async (selected) =>
      withTimeout(
        `${selected.company.company_name}/legacy_tinyfish_agents`,
        args.maxCompanyMs,
        () =>
          analyzeCompanyWithMode(
            "legacy_tinyfish_agents",
            selected.company,
            selected.definitions,
          ),
      ).catch((error) =>
        timeoutAnalysis(
          "legacy_tinyfish_agents",
          selected.company,
          args.maxCompanyMs,
          error instanceof Error ? error.message : String(error),
        ),
      ),
  );

  const finalResults = [
    ...selectedCompanies.map((selected) => selected.fetchPreflight),
    ...legacyResults,
  ].sort((a, b) => {
    return (
      a.companyName.localeCompare(b.companyName) ||
      a.mode.localeCompare(b.mode)
    );
  });

  const markdown = buildMarkdownReport({
    args,
    preflightCandidates,
    selectedCompanies,
    finalResults,
  });

  const outputPath =
    args.outputPath ||
    resolve(
      process.cwd(),
      ".context",
      `pipeline-real-world-benchmark-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.md`,
    );
  const jsonPath = outputPath.replace(/\.md$/i, ".json");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        args,
        preflightCandidates: preflightCandidates.map((candidate) => ({
          companyId: candidate.company.company_id,
          companyName: candidate.company.company_name,
          enabledDefinitions: candidate.definitions.length,
          history: candidate.history,
        })),
        selectedCompanies: selectedCompanies.map((selected) => ({
          companyId: selected.company.company_id,
          companyName: selected.company.company_name,
          enabledDefinitions: selected.definitions.length,
          history: selected.history,
          selectionBucket: selected.selectionBucket,
          fetchPreflight: selected.fetchPreflight,
        })),
        finalResults,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(markdown);
  console.log("");
  console.log("[REAL-BENCH] Markdown report: %s", outputPath);
  console.log("[REAL-BENCH] JSON report: %s", jsonPath);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
