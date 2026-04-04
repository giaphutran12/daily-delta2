#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyFreshness,
  scoreSignal,
  type FreshnessClass,
} from "../../src/services/signal-scoring.ts";
import type { Signal } from "../../src/lib/types.ts";

type ExpectedTier = "high" | "medium" | "low";

interface EvalEntry {
  signal_type: string;
  title: string;
  summary: string;
  source: string;
  detected_at: string;
  url?: string;
  expected_tier: ExpectedTier;
  expected_freshness: FreshnessClass;
  notes: string;
}

interface EvalResult extends EvalEntry {
  actual_tier: ExpectedTier;
  actual_freshness: FreshnessClass;
  score: number;
  pass_tier: boolean;
  pass_freshness: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_PATH = path.join(__dirname, "signal-eval-set.json");

function toSignal(entry: EvalEntry): Signal {
  return {
    signal_id: "",
    company_id: "",
    signal_type: entry.signal_type,
    source: entry.source,
    title: entry.title,
    content: entry.summary,
    url: entry.url ?? null,
    detected_at: entry.detected_at,
    created_at: entry.detected_at,
  };
}

function formatCell(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

function printResults(results: EvalResult[]): void {
  const header = [
    formatCell("type", 18),
    formatCell("tier", 13),
    formatCell("freshness", 19),
    formatCell("score", 7),
    formatCell("title", 44),
    "status",
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const result of results) {
    const tier = `${result.actual_tier}/${result.expected_tier}`;
    const freshness = `${result.actual_freshness}/${result.expected_freshness}`;
    const status = result.pass_tier && result.pass_freshness ? "PASS" : "FAIL";

    console.log(
      [
        formatCell(result.signal_type, 18),
        formatCell(tier, 13),
        formatCell(freshness, 19),
        formatCell(String(result.score), 7),
        formatCell(result.title, 44),
        status,
      ].join(" | "),
    );
  }
}

async function main(): Promise<void> {
  const raw = await readFile(DATASET_PATH, "utf8");
  const entries = JSON.parse(raw) as EvalEntry[];

  const results = entries.map((entry): EvalResult => {
    const signal = toSignal(entry);
    const { score, tier } = scoreSignal(signal);
    const freshness = classifyFreshness(entry.detected_at);

    return {
      ...entry,
      actual_tier: tier,
      actual_freshness: freshness,
      score,
      pass_tier: tier === entry.expected_tier,
      pass_freshness: freshness === entry.expected_freshness,
    };
  });

  printResults(results);

  const tierPasses = results.filter((result) => result.pass_tier).length;
  const freshnessPasses = results.filter((result) => result.pass_freshness).length;
  const fullPasses = results.filter(
    (result) => result.pass_tier && result.pass_freshness,
  ).length;

  console.log("");
  console.log(`Tier matches: ${tierPasses}/${results.length}`);
  console.log(`Freshness matches: ${freshnessPasses}/${results.length}`);
  console.log(`Full matches: ${fullPasses}/${results.length}`);

  const failures = results.filter(
    (result) => !result.pass_tier || !result.pass_freshness,
  );

  if (failures.length > 0) {
    console.log("");
    console.log("Mismatches:");
    for (const failure of failures) {
      console.log(
        `- ${failure.title}: tier ${failure.actual_tier}/${failure.expected_tier}, freshness ${failure.actual_freshness}/${failure.expected_freshness}`,
      );
      console.log(`  notes: ${failure.notes}`);
    }
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
