#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TINYFISH_SYNC_URL = "https://agent.tinyfish.ai/v1/automation/run";
const DEFAULT_SCENARIO_FILE = path.join("scripts", "tinyfish-scenarios.json");
const DEFAULT_OUTPUT_FILE = path.join(
  ".sisyphus",
  "evidence",
  "tinyfish-qa-report.json",
);

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be configured`);
  }
  return value;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function normalizeIssue(issue, fallbackScenarioId) {
  return {
    type: issue?.type ?? "functional",
    severity: issue?.severity ?? "medium",
    title: issue?.title ?? `Issue in ${fallbackScenarioId}`,
    evidence: issue?.evidence ?? "",
    repro_steps: Array.isArray(issue?.repro_steps) ? issue.repro_steps : [],
  };
}

function normalizeScenarioResult(result, scenario, fallbackNotes = "") {
  return {
    scenario_id: result?.scenario_id ?? scenario.id,
    path: result?.path ?? scenario.path,
    status: result?.status ?? "blocked",
    issues: Array.isArray(result?.issues)
      ? result.issues.map((issue) => normalizeIssue(issue, scenario.id))
      : [],
    notes: result?.notes ?? fallbackNotes,
  };
}

function buildScenarioPrompt({
  baseUrl,
  scenario,
  qaEmail,
  qaPassword,
}) {
  const targetUrl = new URL(scenario.path, `${baseUrl}/`).toString();
  const viewportPrompt =
    scenario.viewport === "mobile"
      ? "Use a mobile viewport."
      : "Use a desktop viewport.";

  const authPrompt =
    scenario.auth === "required"
      ? qaEmail && qaPassword
        ? `Authenticate with this test account before testing if needed. Email: "${qaEmail}". Password: "${qaPassword}".`
        : 'If login is required and credentials are unavailable, return status "blocked".'
      : "Do not log in unless the route forces it.";

  return `You are a QA agent testing exactly one Daily Delta scenario.

Important rules:
- Test ONLY this one scenario.
- Do not branch into unrelated exploration.
- If you discover extra issues while completing this exact flow, include them only if they are directly encountered in this scenario.
- Return ONLY valid JSON. No markdown. No prose outside JSON.

Scenario:
- scenario_id: ${scenario.id}
- title: ${scenario.title}
- target_url: ${targetUrl}
- path: ${scenario.path}
- viewport: ${scenario.viewport}

Execution rules:
- ${viewportPrompt}
- ${authPrompt}
- ${scenario.instructions}

Return exactly this JSON shape:
{
  "scenario_id": "${scenario.id}",
  "path": "${scenario.path}",
  "status": "pass | fail | blocked",
  "issues": [
    {
      "type": "functional | ui | ux | broken-image | chat",
      "severity": "low | medium | high | critical",
      "title": "short issue title",
      "evidence": "what you saw",
      "repro_steps": ["step 1", "step 2"]
    }
  ],
  "notes": "short summary"
}`;
}

async function runTinyfishScenario({
  apiKey,
  baseUrl,
  scenario,
  qaEmail,
  qaPassword,
}) {
  if (scenario.auth === "required" && (!qaEmail || !qaPassword)) {
    return normalizeScenarioResult(
      null,
      scenario,
      "Blocked: authenticated scenario requires TINYFISH_QA_EMAIL and TINYFISH_QA_PASSWORD.",
    );
  }

  const targetUrl = new URL(scenario.path, `${baseUrl}/`).toString();
  const goal = buildScenarioPrompt({ baseUrl, scenario, qaEmail, qaPassword });

  const response = await fetch(TINYFISH_SYNC_URL, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: targetUrl,
      goal,
    }),
  });

  if (!response.ok) {
    return normalizeScenarioResult(
      null,
      scenario,
      `TinyFish API error: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  if (payload.status !== "COMPLETED") {
    return normalizeScenarioResult(
      null,
      scenario,
      payload.error?.message ?? "TinyFish run failed",
    );
  }

  let result = payload.result;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return normalizeScenarioResult(
        null,
        scenario,
        `TinyFish returned non-JSON output: ${result}`,
      );
    }
  }

  return normalizeScenarioResult(result, scenario);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );

  return results;
}

async function main() {
  const apiKey = getRequiredEnv("TINYFISH_API_KEY");
  const baseUrl = normalizeBaseUrl(getRequiredEnv("TINYFISH_QA_BASE_URL"));
  const qaEmail = process.env.TINYFISH_QA_EMAIL ?? "";
  const qaPassword = process.env.TINYFISH_QA_PASSWORD ?? "";
  const scenarioFile = process.argv[2] ?? DEFAULT_SCENARIO_FILE;
  const outputFile = process.env.TINYFISH_QA_OUTPUT ?? DEFAULT_OUTPUT_FILE;
  const concurrency = Number(process.env.TINYFISH_QA_CONCURRENCY ?? "10");
  const selectedScenarioIds = new Set(
    (process.env.TINYFISH_QA_SCENARIOS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const scenarios = JSON.parse(
    await readFile(path.resolve(scenarioFile), "utf8"),
  );

  const filteredScenarios = selectedScenarioIds.size
    ? scenarios.filter((scenario) => selectedScenarioIds.has(scenario.id))
    : scenarios;

  const results = await mapWithConcurrency(
    filteredScenarios,
    Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 10,
    (scenario) =>
      runTinyfishScenario({
        apiKey,
        baseUrl,
        scenario,
        qaEmail,
        qaPassword,
      }),
  );

  const summary = results.reduce(
    (acc, result) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1;
      acc.issues += result.issues.length;
      return acc;
    },
    { pass: 0, fail: 0, blocked: 0, issues: 0 },
  );

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    scenario_count: results.length,
    summary,
    results,
  };

  const outputPath = path.resolve(outputFile);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`TinyFish QA report written to ${outputPath}`);
  console.log(JSON.stringify(summary));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
