#!/usr/bin/env npx tsx

/**
 * Side-by-side injected signal benchmark for Daily Delta.
 *
 * This compares:
 *   1. TinyFish browser-agent extraction
 *   2. search + fetch + Claude extraction
 *
 * Both modes are pointed at the same public fixture URL exposed from localhost
 * through tinyfi.sh, so the comparison is deterministic.
 *
 * Example:
 *   npm run dev
 *   npm run share:tinyfi
 *   TINYFISH_API_KEY=... ANTHROPIC_API_KEY=... \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run bench:pipeline-modes -- \
 *     --public-base-url https://your-subdomain.tinyfi.sh \
 *     --company-id <uuid>
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  benchmarkCompanyWithLegacyAgents,
  benchmarkCompanyWithSearchFetchExtract,
} from "../src/services/pipeline-service";
import { createAdminClient } from "../src/lib/supabase/admin";
import { classifyFreshness } from "../src/services/signal-scoring";
import { getCompaniesByIds, getTrackedActiveCompanies } from "../src/services/company-service";
import type { Company, CompanyPipelineResult, SignalDefinition } from "../src/lib/types";

type BenchmarkMode = "legacy_tinyfish_agents" | "search_fetch_extract";

interface Args {
  publicBaseUrl: string;
  companyIds: string[];
  allActive: boolean;
  limit?: number;
  concurrency: number;
  modes: BenchmarkMode[];
  keepData: boolean;
  outputPath?: string;
}

interface StoredSignalRow {
  signal_id: string;
  company_id: string;
  signal_type: string;
  source: string;
  title: string;
  content: string;
  url: string | null;
  detected_at: string | null;
  created_at: string;
  priority_score: number | null;
  priority_tier: "high" | "medium" | "low" | null;
}

interface ModeRunResult {
  mode: BenchmarkMode;
  companyId: string;
  companyName: string;
  benchmarkToken: string;
  fixtureUrl: string;
  durationMs: number;
  pipeline: CompanyPipelineResult;
  storedSignals: Array<
    StoredSignalRow & {
      freshness: ReturnType<typeof classifyFreshness>;
    }
  >;
  reportId?: string;
  reportContainsToken: boolean;
  canaryCaptured: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  npm run bench:pipeline-modes -- --public-base-url <https://...tinyfi.sh> [options]",
    "",
    "Options:",
    "  --company-id <uuid>         Benchmark one company (repeatable)",
    "  --all-active                Benchmark all active tracked companies",
    "  --limit <n>                 Limit the all-active company set",
    "  --concurrency <n>           Run up to n companies in parallel per mode (default: 1)",
    "  --mode <legacy|fetch|both>  Default: both",
    "  --keep-data                 Keep benchmark-created rows instead of cleaning up",
    "  --output <path>             Write markdown summary to a custom file",
    "  --help                      Show this help text",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    publicBaseUrl: process.env.TINYFISH_BENCH_BASE_URL ?? "",
    companyIds: [],
    allActive: false,
    concurrency: 1,
    modes: ["legacy_tinyfish_agents", "search_fetch_extract"],
    keepData: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--public-base-url":
        args.publicBaseUrl = argv[++i] ?? "";
        break;
      case "--company-id":
        args.companyIds.push(argv[++i] ?? "");
        break;
      case "--all-active":
        args.allActive = true;
        break;
      case "--limit":
        args.limit = Number(argv[++i] ?? "");
        break;
      case "--concurrency":
        args.concurrency = Number(argv[++i] ?? "");
        break;
      case "--mode": {
        const value = (argv[++i] ?? "both").toLowerCase();
        if (value === "legacy") args.modes = ["legacy_tinyfish_agents"];
        else if (value === "fetch") args.modes = ["search_fetch_extract"];
        else args.modes = ["legacy_tinyfish_agents", "search_fetch_extract"];
        break;
      }
      case "--keep-data":
        args.keepData = true;
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

  if (!args.publicBaseUrl) {
    throw new Error(
      "Missing --public-base-url (or TINYFISH_BENCH_BASE_URL). Run `npx tinyfi.sh http 3000` and pass the public URL here.",
    );
  }

  if (!args.allActive && args.companyIds.length === 0) {
    throw new Error("Pass at least one --company-id or use --all-active.");
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer.");
  }
  args.concurrency = Math.max(1, Math.floor(args.concurrency));

  return args;
}

function assertRequiredEnv(modes: BenchmarkMode[]): void {
  const required = new Set([
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  if (modes.includes("legacy_tinyfish_agents")) {
    required.add("TINYFISH_API_KEY");
  }
  if (modes.includes("search_fetch_extract")) {
    required.add("ANTHROPIC_API_KEY");
  }

  const missing = [...required].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function resolveCompanies(args: Args): Promise<Company[]> {
  if (args.allActive) {
    const companies = await getTrackedActiveCompanies();
    return typeof args.limit === "number" && args.limit > 0
      ? companies.slice(0, args.limit)
      : companies;
  }

  const companyIds = [...new Set(args.companyIds.filter(Boolean))];
  const companies = await getCompaniesByIds(companyIds);
  if (companies.length !== companyIds.length) {
    const foundIds = new Set(companies.map((company) => company.company_id));
    const missing = companyIds.filter((companyId) => !foundIds.has(companyId));
    throw new Error(`Could not find companies: ${missing.join(", ")}`);
  }
  return companies;
}

function buildFixtureUrl(publicBaseUrl: string, company: Company, token: string): string {
  const url = new URL("/api/benchmark-fixtures/high-signal", normalizeBaseUrl(publicBaseUrl));
  url.searchParams.set("company", company.company_name);
  url.searchParams.set("token", token);
  url.searchParams.set("source", "TechCrunch");
  url.searchParams.set("date", new Date().toISOString().slice(0, 10));
  url.searchParams.set("amount", "$250 million");
  url.searchParams.set("round", "Series F");
  return url.toString();
}

function buildBenchmarkInstructions(companyName: string, token: string): string {
  return [
    `Read this page and extract exactly one fundraising signal for ${companyName}.`,
    `Use the exact article headline as the title, including the benchmark token [${token}].`,
    `Set signal_type to fundraising_signal.`,
    `Set source to the publication name shown on the page.`,
    `Set url to the page URL.`,
    `Set detected_at to the published date visible on the page.`,
    `Return {"signals": []} if the page does not clearly describe a fundraising event for ${companyName}.`,
  ].join(" ");
}

async function createBenchmarkDefinition(
  companyId: string,
  fixtureUrl: string,
  token: string,
  companyName: string,
): Promise<SignalDefinition> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("signal_definitions")
    .insert({
      company_id: companyId,
      is_default: false,
      created_by: null,
      name: `Benchmark Fundraising Signal ${token}`,
      signal_type: "fundraising_signal",
      display_name: `Benchmark Fundraising Signal ${token}`,
      target_url: fixtureUrl,
      search_instructions: buildBenchmarkInstructions(companyName, token),
      scope: "company",
      enabled: true,
      sort_order: 9999,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create benchmark signal definition: ${error.message}`);
  }

  return data as SignalDefinition;
}

async function findBenchmarkSignals(
  companyId: string,
  token: string,
  startedAtIso: string,
): Promise<
  Array<
    StoredSignalRow & {
      freshness: ReturnType<typeof classifyFreshness>;
    }
  >
> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .eq("company_id", companyId)
    .gte("created_at", startedAtIso)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load benchmark signals: ${error.message}`);
  }

  return ((data ?? []) as StoredSignalRow[])
    .filter(
      (signal) =>
        signal.title.includes(token) ||
        signal.content.includes(token) ||
        (signal.url ?? "").includes(token),
    )
    .map((signal) => ({
      ...signal,
      freshness: classifyFreshness(signal.detected_at ?? undefined, signal.created_at),
    }));
}

async function reportContainsToken(reportId: string | undefined, token: string): Promise<boolean> {
  if (!reportId) return false;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reports")
    .select("report_data")
    .eq("report_id", reportId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load benchmark report: ${error.message}`);
  }

  if (!data) return false;
  return JSON.stringify((data as { report_data: unknown }).report_data).includes(token);
}

async function cleanupBenchmarkArtifacts(
  companyId: string,
  definitionId: string,
  token: string,
  reportId?: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { data: signalRows, error: signalLoadError } = await supabase
    .from("signals")
    .select("signal_id, title, content, url")
    .eq("company_id", companyId);
  if (signalLoadError) {
    throw new Error(`Failed to load benchmark signals for cleanup: ${signalLoadError.message}`);
  }

  const signalIds = ((signalRows ?? []) as Array<{
    signal_id: string;
    title: string;
    content: string;
    url: string | null;
  }>)
    .filter(
      (signal) =>
        signal.title.includes(token) ||
        signal.content.includes(token) ||
        (signal.url ?? "").includes(token),
    )
    .map((signal) => signal.signal_id);

  if (reportId) {
    const { error: reportError } = await supabase
      .from("reports")
      .delete()
      .eq("report_id", reportId);
    if (reportError) {
      throw new Error(`Failed to delete benchmark report: ${reportError.message}`);
    }
  }

  if (signalIds.length > 0) {
    const { error: signalError } = await supabase
      .from("signals")
      .delete()
      .in("signal_id", signalIds);
    if (signalError) {
      throw new Error(`Failed to delete benchmark signals: ${signalError.message}`);
    }
  }

  const { error: definitionError } = await supabase
    .from("signal_definitions")
    .delete()
    .eq("id", definitionId);
  if (definitionError) {
    throw new Error(`Failed to delete benchmark definition: ${definitionError.message}`);
  }
}

async function runModeForCompany(
  mode: BenchmarkMode,
  company: Company,
  publicBaseUrl: string,
  keepData: boolean,
): Promise<ModeRunResult> {
  const benchmarkToken = `BENCH-${mode === "legacy_tinyfish_agents" ? "LEGACY" : "FETCH"}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const fixtureUrl = buildFixtureUrl(publicBaseUrl, company, benchmarkToken);
  const definition = await createBenchmarkDefinition(
    company.company_id,
    fixtureUrl,
    benchmarkToken,
    company.company_name,
  );

  const startedAtIso = new Date().toISOString();
  const start = Date.now();

  let pipeline: CompanyPipelineResult;
  let reportId: string | undefined;
  try {
    pipeline =
      mode === "legacy_tinyfish_agents"
        ? await benchmarkCompanyWithLegacyAgents(company, [definition], "manual")
        : await benchmarkCompanyWithSearchFetchExtract(company, [definition], "manual");
    reportId = pipeline.reportId;

    const storedSignals = await findBenchmarkSignals(
      company.company_id,
      benchmarkToken,
      startedAtIso,
    );
    const containsToken = await reportContainsToken(reportId, benchmarkToken);

    return {
      mode,
      companyId: company.company_id,
      companyName: company.company_name,
      benchmarkToken,
      fixtureUrl,
      durationMs: Date.now() - start,
      pipeline,
      storedSignals,
      reportId,
      reportContainsToken: containsToken,
      canaryCaptured:
        storedSignals.some(
          (signal) =>
            signal.signal_type === "fundraising_signal" &&
            signal.priority_tier === "high" &&
            signal.freshness === "fresh",
        ) && containsToken,
    };
  } finally {
    if (!keepData) {
      try {
        await cleanupBenchmarkArtifacts(
          company.company_id,
          definition.id,
          benchmarkToken,
          reportId,
        );
      } catch (error) {
        console.warn(
          "[BENCH] Cleanup warning for %s/%s: %s",
          company.company_name,
          mode,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(2)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${ms}ms`;
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

function buildMarkdownReport(
  args: Args,
  companies: Company[],
  results: ModeRunResult[],
  totalsByMode: Map<BenchmarkMode, number>,
): string {
  const lines: string[] = [
    "# Pipeline Mode Benchmark",
    "",
    `Run at: ${new Date().toISOString()}`,
    `Public fixture base: ${normalizeBaseUrl(args.publicBaseUrl)}`,
    `Companies: ${companies.length}`,
    "",
    "## Mode Summary",
    "",
    "| Mode | Companies | Total Runtime | Under 13m | Canary Captured | Failures |",
    "|------|-----------|---------------|-----------|------------------|----------|",
  ];

  for (const mode of args.modes) {
    const modeResults = results.filter((result) => result.mode === mode);
    const total = totalsByMode.get(mode) ?? 0;
    const canaryPasses = modeResults.filter((result) => result.canaryCaptured).length;
    const failures = modeResults.filter((result) => !!result.pipeline.error).length;
    lines.push(
      `| ${mode} | ${modeResults.length} | ${formatMs(total)} | ${total <= 13 * 60_000 ? "YES" : "NO"} | ${canaryPasses}/${modeResults.length} | ${failures} |`,
    );
  }

  lines.push("", "## Per Company", "", "| Company | Mode | Runtime | Stored Signals | Report | Canary | Notes |", "|---------|------|---------|----------------|--------|--------|-------|");
  for (const result of results) {
    const notes = result.pipeline.error
      ? result.pipeline.error.replace(/\|/g, "/")
      : result.storedSignals.length > 0
        ? result.storedSignals
            .map((signal) => `${signal.title} (${signal.priority_tier ?? "n/a"}, ${signal.freshness})`)
            .join(" ; ")
            .replace(/\|/g, "/")
        : "No benchmark signals stored";

    lines.push(
      `| ${result.companyName} | ${result.mode} | ${formatMs(result.durationMs)} | ${result.storedSignals.length} | ${result.reportContainsToken ? "YES" : "NO"} | ${result.canaryCaptured ? "PASS" : "FAIL"} | ${notes} |`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertRequiredEnv(args.modes);

  const companies = await resolveCompanies(args);
  if (companies.length === 0) {
    throw new Error("No companies matched the requested benchmark scope.");
  }

  const results: ModeRunResult[] = [];
  const totalsByMode = new Map<BenchmarkMode, number>();

  console.log(
    "[BENCH] Running %d mode(s) across %d company(s) with concurrency=%d",
    args.modes.length,
    companies.length,
    args.concurrency,
  );

  for (const mode of args.modes) {
    const modeStart = Date.now();
    console.log("[BENCH] Starting mode: %s", mode);

    const modeResults = await mapWithConcurrency(
      companies,
      args.concurrency,
      async (company) => {
        console.log("[BENCH] %s -> %s", mode, company.company_name);
        return runModeForCompany(
          mode,
          company,
          args.publicBaseUrl,
          args.keepData,
        );
      },
    );
    results.push(...modeResults);

    totalsByMode.set(mode, Date.now() - modeStart);
  }

  const markdown = buildMarkdownReport(args, companies, results, totalsByMode);
  const outputPath =
    args.outputPath ||
    resolve(
      process.cwd(),
      ".context",
      `pipeline-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
    );
  const jsonPath = outputPath.replace(/\.md$/i, ".json");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        publicBaseUrl: normalizeBaseUrl(args.publicBaseUrl),
        companies: companies.map((company) => ({
          companyId: company.company_id,
          companyName: company.company_name,
        })),
        totalsByMode: Object.fromEntries(totalsByMode),
        results,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(markdown);
  console.log("");
  console.log("[BENCH] Markdown report: %s", outputPath);
  console.log("[BENCH] JSON report: %s", jsonPath);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
