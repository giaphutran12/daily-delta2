import { ReportData, normalizeReportData } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function getApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

function getModel(): string {
  return process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
}

function serializeReport(
  rawReportData: ReportData,
  companyName: string,
): string {
  const reportData = normalizeReportData(rawReportData);
  let text = `Company: ${companyName}\nOverview: ${reportData.company_overview}\n\n`;

  for (const section of reportData.sections) {
    if (!section.items || section.items.length === 0) continue;
    text += `=== ${section.display_name} ===\n`;
    for (const s of section.items) {
      text += `- ${s.title}\n  ${s.summary}\n  Source: ${s.source} | Date: ${s.detected_at}\n`;
      if (s.url) text += `  URL: ${s.url}\n`;
    }
    text += "\n";
  }

  return text;
}

async function callOpenRouter(
  messages: Array<{ role: string; content: string }>,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("[OpenRouter] No API key configured, skipping AI generation");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dailydelta.app",
      },
      body: JSON.stringify({
        model: getModel(),
        messages,
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      console.error("[OpenRouter] API error %d:", res.status, err);
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("[OpenRouter] Call failed:", (err as Error).message);
    return null;
  }
}

export async function generateManualSummary(
  reportData: ReportData,
  companyName: string,
): Promise<string | null> {
  const reportText = serializeReport(reportData, companyName);

  return callOpenRouter([
    {
      role: "system",
      content: `You are an intelligence analyst summarizing company signals. Write a concise executive summary that highlights the most important findings. Focus on:
- Major changes and developments
- Important signals that require attention
- Key company developments and milestones
- Notable patterns or activity trends

Keep it under 500 words. Use clear paragraphs with bold headers using markdown. Be direct and actionable.`,
    },
    {
      role: "user",
      content: `Summarize the following intelligence report:\n\n${reportText}`,
    },
  ]);
}

export async function generateCronBI(
  reportData: ReportData,
  companyName: string,
): Promise<string | null> {
  const reportText = serializeReport(reportData, companyName);

  return callOpenRouter([
    {
      role: "system",
      content: `You are a venture capital analyst writing a brief investment intelligence memo. Analyze the signals from a startup intelligence perspective. Cover:
- **Trajectory**: What the signals indicate about the company's growth direction
- **Strategic Implications**: Key strategic moves and what they mean
- **Market Positioning**: How the company is positioned competitively
- **Competitive Implications**: Threats and advantages relative to competitors
- **Opportunities & Risks**: Potential upside and downside based on the data

Write like a short VC analyst briefing — concise, data-driven, and actionable. Under 600 words. Use markdown formatting with bold section headers.`,
    },
    {
      role: "user",
      content: `Analyze the following intelligence report for ${companyName}:\n\n${reportText}`,
    },
  ]);
}
