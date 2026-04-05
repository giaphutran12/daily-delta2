#!/usr/bin/env npx tsx
/**
 * Benchmark: TinyFish /fetch vs raw fetch() + Readability
 *
 * Compares both approaches on real URLs from the pipeline to measure
 * content quality, completeness, noise, and latency.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx/esm scripts/benchmark-fetch.ts
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Env vars are expected to be passed via the CLI:
//   node --env-file=.env.local --import tsx/esm scripts/benchmark-fetch.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TinyFish Fetch (direct REST call, same as tinyfish-client.ts)
// ---------------------------------------------------------------------------

async function tinyfishFetchPage(
  url: string,
): Promise<{ title: string | null; text: string; error?: string }> {
  const apiKey = process.env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error("TINYFISH_API_KEY not set");

  const response = await fetch("https://api.fetch.tinyfish.ai/fetch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ urls: [url], format: "markdown" }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // Show first 200 chars of error body for debugging
    const shortErr = text.slice(0, 200);
    return { title: null, text: "", error: `HTTP ${response.status}: ${shortErr}` };
  }

  const data = (await response.json()) as {
    results: Array<{ title: string | null; text: string }>;
    errors: Array<{ url: string; error: string }>;
  };

  if (data.errors?.length > 0) {
    return { title: null, text: "", error: data.errors[0].error };
  }

  const result = data.results?.[0];
  if (!result) {
    return { title: null, text: "", error: "No results returned" };
  }

  return { title: result.title, text: result.text };
}

// ---------------------------------------------------------------------------
// Raw fetch + Readability
// ---------------------------------------------------------------------------

async function rawFetchPage(
  url: string,
): Promise<{ title: string | null; text: string; error?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        title: null,
        text: "",
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      // Fallback: just get body text
      const bodyText =
        document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return {
        title: document.title || null,
        text: bodyText.slice(0, 50000),
      };
    }

    return {
      title: article.title ?? null,
      text: (article.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  } catch (err) {
    return {
      title: null,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  url: string;
  label: string;
  tinyfishFetch: {
    title: string | null;
    contentLength: number;
    latencyMs: number;
    error?: string;
    preview: string;
  };
  rawFetch: {
    title: string | null;
    contentLength: number;
    latencyMs: number;
    error?: string;
    preview: string;
  };
}

const TEST_URLS: Array<{ url: string; label: string }> = [
  {
    url: "https://example.com",
    label: "example.com (simplest possible)",
  },
  {
    url: "https://httpbin.org/html",
    label: "httpbin HTML (static test page)",
  },
  {
    url: "https://blog.rust-lang.org/2024/10/17/async-fn-closures.html",
    label: "Rust blog post (from TF docs example)",
  },
  {
    url: "https://news.ycombinator.com/",
    label: "HN front page",
  },
  {
    url: "https://stripe.com/blog",
    label: "Stripe blog",
  },
  {
    url: "https://posthog.com/careers",
    label: "PostHog careers",
  },
];

function preview(text: string, maxLen = 200): string {
  const clean = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "..." : clean;
}

async function benchmarkUrl(entry: {
  url: string;
  label: string;
}): Promise<BenchmarkResult> {
  // Run both fetches in parallel
  const [tfResult, rawResult] = await Promise.all([
    (async () => {
      const start = Date.now();
      const result = await tinyfishFetchPage(entry.url);
      return { ...result, latencyMs: Date.now() - start };
    })(),
    (async () => {
      const start = Date.now();
      const result = await rawFetchPage(entry.url);
      return { ...result, latencyMs: Date.now() - start };
    })(),
  ]);

  return {
    url: entry.url,
    label: entry.label,
    tinyfishFetch: {
      title: tfResult.title,
      contentLength: tfResult.text.length,
      latencyMs: tfResult.latencyMs,
      error: tfResult.error,
      preview: preview(tfResult.text),
    },
    rawFetch: {
      title: rawResult.title,
      contentLength: rawResult.text.length,
      latencyMs: rawResult.latencyMs,
      error: rawResult.error,
      preview: preview(rawResult.text),
    },
  };
}

function formatResults(results: BenchmarkResult[]): string {
  const lines: string[] = [
    "# Fetch Benchmark Results",
    `\nRun at: ${new Date().toISOString()}\n`,
  ];

  // Summary table
  lines.push(
    "| URL | TF Content | Raw Content | TF Latency | Raw Latency | TF Status | Raw Status |",
  );
  lines.push(
    "|-----|-----------|-------------|------------|-------------|-----------|------------|",
  );
  for (const r of results) {
    const tfStatus = r.tinyfishFetch.error ? `ERR` : "OK";
    const rawStatus = r.rawFetch.error ? `ERR` : "OK";
    lines.push(
      `| ${r.label} | ${r.tinyfishFetch.contentLength.toLocaleString()} chars | ${r.rawFetch.contentLength.toLocaleString()} chars | ${r.tinyfishFetch.latencyMs}ms | ${r.rawFetch.latencyMs}ms | ${tfStatus} | ${rawStatus} |`,
    );
  }

  // Detail per URL
  for (const r of results) {
    lines.push(`\n---\n## ${r.label}`);
    lines.push(`URL: ${r.url}\n`);

    lines.push("### TinyFish /fetch");
    if (r.tinyfishFetch.error) {
      lines.push(`**Error:** ${r.tinyfishFetch.error}`);
    } else {
      lines.push(`- Title: ${r.tinyfishFetch.title ?? "(none)"}`);
      lines.push(
        `- Content: ${r.tinyfishFetch.contentLength.toLocaleString()} chars`,
      );
      lines.push(`- Latency: ${r.tinyfishFetch.latencyMs}ms`);
      lines.push(`- Preview: ${r.tinyfishFetch.preview}`);
    }

    lines.push("\n### Raw fetch + Readability");
    if (r.rawFetch.error) {
      lines.push(`**Error:** ${r.rawFetch.error}`);
    } else {
      lines.push(`- Title: ${r.rawFetch.title ?? "(none)"}`);
      lines.push(
        `- Content: ${r.rawFetch.contentLength.toLocaleString()} chars`,
      );
      lines.push(`- Latency: ${r.rawFetch.latencyMs}ms`);
      lines.push(`- Preview: ${r.rawFetch.preview}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Benchmarking ${TEST_URLS.length} URLs...\n`);

  const results: BenchmarkResult[] = [];
  for (const entry of TEST_URLS) {
    console.log(`  Fetching: ${entry.label}...`);
    const result = await benchmarkUrl(entry);
    results.push(result);

    const tfLen = result.tinyfishFetch.contentLength.toLocaleString();
    const rawLen = result.rawFetch.contentLength.toLocaleString();
    const tfMs = result.tinyfishFetch.latencyMs;
    const rawMs = result.rawFetch.latencyMs;
    const tfErr = result.tinyfishFetch.error ? ` (ERR: ${result.tinyfishFetch.error})` : "";
    const rawErr = result.rawFetch.error ? ` (ERR: ${result.rawFetch.error})` : "";
    console.log(`    TF: ${tfLen} chars, ${tfMs}ms${tfErr}`);
    console.log(`    Raw: ${rawLen} chars, ${rawMs}ms${rawErr}`);
  }

  const report = formatResults(results);
  console.log("\n" + report);

  const outPath = resolve(process.cwd(), ".context/fetch-benchmark-results.md");
  writeFileSync(outPath, report, "utf8");
  console.log(`\nResults saved to ${outPath}`);
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
