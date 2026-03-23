import { NextRequest } from "next/server";
import {
  convertToModelMessages,
  streamText,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { isTracking } from "@/services/company-service";
import {
  getOrCreateSession,
  saveMessage,
  updateSessionTimestamp,
} from "@/services/chat-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const SIGNAL_COLUMNS = "signal_type, title, content, source, url, detected_at";

interface SignalRow {
  signal_type: string;
  title: string;
  content: string;
  source: string;
  url: string | null;
  detected_at: string;
}

interface CompanyRow {
  company_name: string;
  domain: string;
  industry: string | null;
  description: string | null;
}

function formatSignal(s: SignalRow): string {
  const date = new Date(s.detected_at).toISOString().slice(0, 10);
  const line = `[${date}] ${s.signal_type.toUpperCase()} | "${s.title}" | via ${s.source}`;
  const content = s.content ? `\n  ${s.content}` : "";
  const url = s.url ? `\n  URL: ${s.url}` : "";
  return line + content + url;
}

function buildSystemPrompt(
  company: CompanyRow | null,
  signals: SignalRow[],
  totalCount: number,
): string {
  const name = company?.company_name ?? "Unknown Company";
  const domain = company?.domain ?? "";
  const industry = company?.industry ?? "Unknown";
  const description = company?.description ?? "";

  return `You are an AI analyst for ${name} (${domain}).
Industry: ${industry}
${description ? `Description: ${description}` : ""}

You have access to ${totalCount} detected signals for this company.
Below are the 15 most recent. Use your tools to search or filter for more
when the user asks about specific topics, time ranges, or signal types.

Recent signals:
${signals.map(formatSignal).join("\n\n")}

Always use tools when the user asks about something not covered above.`;
}

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const companyId = parts[parts.indexOf("chat") + 1];

  if (!companyId) {
    return Response.json({ error: "Company ID is required" }, { status: 400 });
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const session = await getOrCreateSession(companyId, ctx.userId);

  // Save the user's latest message
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg) {
    const textParts = (lastUserMsg.parts ?? []).filter(
      (p): p is { type: "text"; text: string } =>
        (p as { type: string }).type === "text",
    );
    const textContent = textParts.map((p) => p.text).join("") || "";
    if (textContent) {
      await saveMessage(
        session.session_id,
        "user",
        textContent,
        lastUserMsg.parts as unknown[] | null,
      );
    }
  }

  // Load 15 latest signals + total count + company context
  const supabase = createAdminClient();
  const [{ data: signals }, { count: totalCount }, { data: company }] =
    await Promise.all([
      supabase
        .from("signals")
        .select(SIGNAL_COLUMNS)
        .eq("company_id", companyId)
        .order("detected_at", { ascending: false })
        .limit(15),
      supabase
        .from("signals")
        .select("signal_id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabase
        .from("companies")
        .select("company_name, domain, industry, description")
        .eq("company_id", companyId)
        .single(),
    ]);

  const systemPrompt = buildSystemPrompt(
    company as CompanyRow | null,
    (signals ?? []) as SignalRow[],
    totalCount ?? 0,
  );

  // Tools — scoped to this company via closure over companyId + supabase
  const searchSignals = tool({
    description:
      "Search signals by keyword across titles and content. Use when the user asks about a specific topic, event, or term not in the initial context.",
    inputSchema: z.object({
      query: z.string().describe("Search keyword or phrase"),
      limit: z
        .number()
        .optional()
        .default(20)
        .describe("Max results to return"),
    }),
    execute: async ({ query, limit }) => {
      const { data } = await supabase
        .from("signals")
        .select(SIGNAL_COLUMNS)
        .eq("company_id", companyId)
        .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
        .order("detected_at", { ascending: false })
        .limit(limit);
      return {
        signals: (data ?? []).map(formatSignal),
        count: data?.length ?? 0,
      };
    },
  });

  const filterSignals = tool({
    description:
      "Filter signals by type and/or date range. Use when the user asks about a category (hiring, launches, funding, etc.) or a time period.",
    inputSchema: z.object({
      signal_type: z
        .string()
        .optional()
        .describe(
          "Signal type, e.g. product_launch, hiring_trend, general_news, pricing_update, fundraising_signal, competitive_landscape, leading_indicator, founder_contact",
        ),
      after: z
        .string()
        .optional()
        .describe("ISO date — only signals detected after this date"),
      before: z
        .string()
        .optional()
        .describe("ISO date — only signals detected before this date"),
      limit: z
        .number()
        .optional()
        .default(30)
        .describe("Max results"),
    }),
    execute: async ({ signal_type, after, before, limit }) => {
      let query = supabase
        .from("signals")
        .select(SIGNAL_COLUMNS)
        .eq("company_id", companyId)
        .order("detected_at", { ascending: false })
        .limit(limit);

      if (signal_type) query = query.eq("signal_type", signal_type);
      if (after) query = query.gte("detected_at", after);
      if (before) query = query.lte("detected_at", before);

      const { data } = await query;
      return {
        signals: (data ?? []).map(formatSignal),
        count: data?.length ?? 0,
      };
    },
  });

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools: { search_signals: searchSignals, filter_signals: filterSignals },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    onFinish: async ({ responseMessage }) => {
      const textParts = responseMessage.parts.filter(
        (p): p is { type: "text"; text: string } => p.type === "text",
      );
      const text = textParts.map((p) => p.text).join("");
      if (text) {
        await saveMessage(session.session_id, "assistant", text, null);
      }
      await updateSessionTimestamp(session.session_id);
    },
  });
});
