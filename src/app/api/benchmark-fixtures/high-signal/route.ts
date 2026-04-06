import { NextRequest } from "next/server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsePublishedDate(value: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString().slice(0, 10)
    : parsed.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const company = request.nextUrl.searchParams.get("company")?.trim() || "Stripe";
  const token = request.nextUrl.searchParams.get("token")?.trim() || "BENCH-DEMO";
  const source = request.nextUrl.searchParams.get("source")?.trim() || "TechCrunch";
  const amount = request.nextUrl.searchParams.get("amount")?.trim() || "$250 million";
  const round = request.nextUrl.searchParams.get("round")?.trim() || "Series F";
  const date = parsePublishedDate(request.nextUrl.searchParams.get("date"));
  const investors =
    request.nextUrl.searchParams.get("investors")?.trim() ||
    "Sequoia Capital, Thrive Capital, and existing backers";
  const useOfFunds =
    request.nextUrl.searchParams.get("useOfFunds")?.trim() ||
    "expand enterprise payments, global treasury products, and AI-driven fraud prevention";

  const headline = `${company} raises ${amount} ${round} to accelerate enterprise payments [${token}]`;
  const pageUrl = request.nextUrl.toString();

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(headline)}</title>
    <meta name="description" content="${escapeHtml(
      `${company} has raised ${amount} in a ${round} round according to ${source}.`,
    )}" />
  </head>
  <body style="font-family: Georgia, serif; margin: 40px auto; max-width: 760px; line-height: 1.6; color: #111;">
    <article>
      <header>
        <p style="font-family: monospace; font-size: 12px; color: #666;">Benchmark fixture token: ${escapeHtml(token)}</p>
        <h1>${escapeHtml(headline)}</h1>
        <p><strong>Publication:</strong> ${escapeHtml(source)}</p>
        <p><strong>Published:</strong> <time datetime="${escapeHtml(date)}">${escapeHtml(date)}</time></p>
        <p><strong>Canonical URL:</strong> ${escapeHtml(pageUrl)}</p>
      </header>

      <p>
        ${escapeHtml(company)} announced that it has raised ${escapeHtml(amount)} in a
        ${escapeHtml(round)} round to ${escapeHtml(useOfFunds)}.
        The round was led by ${escapeHtml(investors)}.
      </p>

      <p>
        Executives said the new capital will be used to grow the company’s enterprise
        sales team, deepen banking partnerships, and launch new infrastructure for
        large multinational customers. The company said the financing marks one of its
        most important capital events in the past 24 months.
      </p>

      <p>
        This page is a controlled benchmark fixture for Daily Delta. The unique
        benchmark token <strong>${escapeHtml(token)}</strong> should appear in the
        extracted signal title exactly as written, and the output should keep this page
        URL as the signal URL.
      </p>
    </article>
  </body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
