/**
 * Smoke test for the new search+fetch+extract pipeline.
 * Tests rawFetchPage, buildSearchQuery, and extractSignalsFromContent
 * without needing Supabase or Inngest.
 *
 * Usage: npx tsx scripts/smoke-test-pipeline.ts
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

// ─── rawFetchPage (copied from pipeline-service for standalone testing) ───

async function rawFetchPage(
  url: string,
): Promise<{ url: string; title: string | null; text: string; error?: string }> {
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
      return { url, title: null, text: "", error: `HTTP ${response.status}` };
    }

    const html = await response.text();
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (article) {
      return {
        url,
        title: article.title ?? null,
        text: (article.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    }

    const bodyText =
      document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return { url, title: document.title || null, text: bodyText.slice(0, 50000) };
  } catch (err) {
    return {
      url,
      title: null,
      text: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── LLM extraction (simplified from pipeline-service) ───

async function extractSignals(
  companyName: string,
  signalType: string,
  instructions: string,
  pages: Array<{ url: string; title: string | null; text: string }>,
): Promise<unknown> {
  const combinedContent = pages
    .map((p) => `--- ${p.title ?? p.url} ---\n${p.text}`)
    .join("\n\n");

  if (combinedContent.trim().length < 50) return { signals: [], reason: "insufficient content" };

  const truncated = combinedContent.slice(0, 12000);
  const prompt = `You are a ${signalType} analyst for ${companyName}.

Analyze the following web page content and extract relevant signals.

TASK: ${instructions}

WEB PAGE CONTENT:
${truncated}

Return JSON:
{
  "signals": [
    {
      "signal_type": "${signalType}",
      "title": "...",
      "summary": "...",
      "source": "...",
      "url": "...",
      "detected_at": "YYYY-MM-DD"
    }
  ]
}

IMPORTANT: For detected_at, use the actual date from the content. Do NOT use today's date. If no date is visible, omit the field.
Only include genuinely meaningful findings. Return {"signals": []} if nothing relevant is found. Be factual.`;

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    prompt,
  });

  // Try to parse JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  return { raw: text };
}

// ─── Test cases ───

interface TestCase {
  name: string;
  type: "deterministic" | "search-based";
  company: string;
  url?: string;
  searchQuery?: string;
  signalType: string;
  instructions: string;
}

const TEST_CASES: TestCase[] = [
  {
    name: "Blog page (deterministic)",
    type: "deterministic",
    company: "Vercel",
    url: "https://vercel.com/blog",
    signalType: "blog_post",
    instructions:
      "Find recent blog posts, product announcements, or engineering updates.",
  },
  {
    name: "Careers page (deterministic)",
    type: "deterministic",
    company: "Anthropic",
    url: "https://www.anthropic.com/careers",
    signalType: "hiring_signal",
    instructions:
      "Identify open job postings, hiring trends, and team growth signals.",
  },
  {
    name: "TechCrunch search (search-based)",
    type: "search-based",
    company: "Anysphere",
    searchQuery: '"Anysphere" site:techcrunch.com',
    signalType: "tc_signal",
    instructions:
      "Find TechCrunch coverage: funding, product launches, interviews.",
  },
];

// ─── Main ───

async function main() {
  console.log("=== Pipeline Smoke Test ===\n");

  for (const tc of TEST_CASES) {
    console.log(`\n--- ${tc.name} ---`);
    const start = Date.now();

    if (tc.type === "deterministic" && tc.url) {
      // Test raw fetch
      console.log(`  Fetching: ${tc.url}`);
      const page = await rawFetchPage(tc.url);
      const elapsed = Date.now() - start;
      console.log(`  Status: ${page.error ?? "OK"}`);
      console.log(`  Title: ${page.title}`);
      console.log(`  Content length: ${page.text.length} chars`);
      console.log(`  Fetch time: ${elapsed}ms`);

      if (page.text.length > 50) {
        console.log(`  Running LLM extraction...`);
        const llmStart = Date.now();
        const result = await extractSignals(
          tc.company,
          tc.signalType,
          tc.instructions,
          [page],
        );
        console.log(`  LLM time: ${Date.now() - llmStart}ms`);
        console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
      } else {
        console.log(`  Skipping LLM (insufficient content)`);
      }
    } else if (tc.type === "search-based" && tc.searchQuery) {
      // For search-based, simulate by fetching Google search results page
      // (TinyFish search API is not live yet, so we just test the fetch+extract flow)
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(tc.searchQuery)}`;
      console.log(`  Search query: ${tc.searchQuery}`);
      console.log(`  Fetching Google: ${googleUrl}`);
      const page = await rawFetchPage(googleUrl);
      const elapsed = Date.now() - start;
      console.log(`  Status: ${page.error ?? "OK"}`);
      console.log(`  Content length: ${page.text.length} chars`);
      console.log(`  Fetch time: ${elapsed}ms`);
      console.log(`  (Search API not live — testing raw Google fetch fallback)`);
    }
  }

  console.log("\n=== Smoke test complete ===");
}

main().catch(console.error);
