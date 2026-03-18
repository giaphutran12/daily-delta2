import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { SignalFinding } from "@/lib/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface AgentSnapshotRow {
  id: string;
  company_id: string;
  signal_definition_id: string | null;
  snapshot_date: string;
  raw_response: unknown;
  created_at: string;
}

export interface DeltaComputationResult {
  newSignals: SignalFinding[];
  changedSignals: SignalFinding[];
  llmSummary: string | null;
}

export const DELTA_INTEGRATION_POINT =
  "Wire into run-agents flow after each agent completes: fetch previous snapshot -> compute fallback delta -> store today snapshot -> pass delta-only signals to report generation (T12).";

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || null;
}

function getModel(): string {
  return process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
}

function normalizeForHash(value?: string): string {
  return (value || "").trim().toLowerCase();
}

function buildSignalHash(signal: SignalFinding): string {
  const title = normalizeForHash(signal.title);
  const url = normalizeForHash(signal.url);
  const source = normalizeForHash(signal.source);
  return createHash("sha256").update(`${title}|${url}|${source}`).digest("hex");
}

function normalizeDeltaList(raw: unknown): SignalFinding[] {
  if (!Array.isArray(raw)) return [];

  const normalized: SignalFinding[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const row = item as Record<string, unknown>;
    const title = row.title;
    const source = row.source;
    const summary = row.summary;

    if (
      typeof title !== "string" ||
      typeof source !== "string" ||
      typeof summary !== "string"
    ) {
      continue;
    }

    normalized.push({
      signal_type:
        typeof row.signal_type === "string" ? row.signal_type : "general_news",
      title,
      source,
      summary,
      ...(typeof row.url === "string" ? { url: row.url } : {}),
      ...(typeof row.detected_at === "string"
        ? { detected_at: row.detected_at }
        : {}),
      ...(typeof row.signal_definition_id === "string"
        ? { signal_definition_id: row.signal_definition_id }
        : {}),
    });
  }

  return normalized;
}

function parseLlmJson(content: string): {
  changedSignals?: unknown;
  summary?: unknown;
} | null {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as {
      changedSignals?: unknown;
      summary?: unknown;
    };
  } catch {
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!codeBlock || !codeBlock[1]) return null;

    try {
      return JSON.parse(codeBlock[1]) as {
        changedSignals?: unknown;
        summary?: unknown;
      };
    } catch {
      return null;
    }
  }
}

async function callOpenRouterForDelta(
  todaySignals: SignalFinding[],
  yesterdaySignals: SignalFinding[],
  companyName: string,
): Promise<{ changedSignals: SignalFinding[]; summary: string | null }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log("[DELTA] OpenRouter API key missing, skipping LLM summary");
    return { changedSignals: [], summary: null };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const prompt =
      "Compare these two sets of signals. Identify what is NEW or CHANGED in today's data. Return only new/changed signals as JSON.";

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://dailydelta.app",
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          {
            role: "system",
            content:
              "You analyze daily company signals. Return strict JSON only with keys: changedSignals (array) and summary (string).",
          },
          {
            role: "user",
            content: `${prompt}\n\nCompany: ${companyName}\n\nYesterday:\n${JSON.stringify(
              yesterdaySignals,
            )}\n\nToday:\n${JSON.stringify(todaySignals)}`,
          },
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[DELTA] OpenRouter API error %d: %s", res.status, errorText);
      return { changedSignals: [], summary: null };
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (!content) return { changedSignals: [], summary: null };

    const parsed = parseLlmJson(content);
    if (!parsed) return { changedSignals: [], summary: null };

    const changedSignals = normalizeDeltaList(parsed.changedSignals);
    const summary = typeof parsed.summary === "string" ? parsed.summary : null;

    return { changedSignals, summary };
  } catch (error) {
    console.error("[DELTA] LLM delta comparison failed:", (error as Error).message);
    return { changedSignals: [], summary: null };
  }
}

export async function storeSnapshot(
  companyId: string,
  signalDefinitionId: string,
  rawResponse: unknown,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("agent_snapshots").insert({
    company_id: companyId,
    signal_definition_id: signalDefinitionId,
    snapshot_date: getTodayDate(),
    raw_response: rawResponse,
  });

  if (error) {
    throw new Error(`[DELTA] Failed to store snapshot: ${error.message}`);
  }
}

export async function getPreviousSnapshot(
  companyId: string,
  signalDefinitionId: string,
): Promise<AgentSnapshotRow | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("agent_snapshots")
    .select("id, company_id, signal_definition_id, snapshot_date, raw_response, created_at")
    .eq("company_id", companyId)
    .eq("signal_definition_id", signalDefinitionId)
    .lt("snapshot_date", getTodayDate())
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`[DELTA] Failed to fetch previous snapshot: ${error.message}`);
  }

  return (data as AgentSnapshotRow | null) ?? null;
}

export function computeDeltaFallback(
  todaySignals: SignalFinding[],
  yesterdaySignals: SignalFinding[],
): SignalFinding[] {
  if (yesterdaySignals.length === 0) return todaySignals;

  const yesterdayHashes = new Set(yesterdaySignals.map(buildSignalHash));
  return todaySignals.filter((signal) => !yesterdayHashes.has(buildSignalHash(signal)));
}

export async function computeDelta(
  todaySignals: SignalFinding[],
  yesterdaySignals: SignalFinding[],
  companyName: string,
): Promise<DeltaComputationResult> {
  const newSignals = computeDeltaFallback(todaySignals, yesterdaySignals);

  if (yesterdaySignals.length === 0) {
    return {
      newSignals,
      changedSignals: [],
      llmSummary: null,
    };
  }

  if (newSignals.length === 0) {
    return {
      newSignals: [],
      changedSignals: [],
      llmSummary: null,
    };
  }

  const { changedSignals, summary } = await callOpenRouterForDelta(
    todaySignals,
    yesterdaySignals,
    companyName,
  );

  return {
    newSignals,
    changedSignals,
    llmSummary: summary,
  };
}
