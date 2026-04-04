import type { Signal, SignalFinding } from "@/lib/types";

const SIGNAL_TYPE_WEIGHTS: Record<string, number> = {
  financing: 30,
  fundraising_signal: 28,
  customer_win: 26,
  partnership: 24,
  leadership_change: 22,
  product_launch: 20,
  pricing_update: 18,
  competitive_landscape: 17,
  revenue_milestone: 16,
  hiring_trend: 12,
  leading_indicator: 10,
  founder_contact: 8,
  general_news: 6,
};

const HIGH_SIGNAL_SOURCES = [
  "techcrunch",
  "the information",
  "crunchbase",
  "company blog",
  "press release",
  "sec",
  "reuters",
  "bloomberg",
];

const LOW_SIGNAL_PATTERNS = [
  "roundup",
  "newsletter",
  "podcast",
  "webinar",
  "thought leadership",
  "listicle",
  "weekly recap",
];

export function scoreSignal(signal: Signal): {
  score: number;
  tier: "high" | "medium" | "low";
} {
  let score = SIGNAL_TYPE_WEIGHTS[signal.signal_type] ?? 10;

  const source = signal.source.toLowerCase();
  const title = signal.title.toLowerCase();
  const content = signal.content.toLowerCase();
  const combinedText = `${title} ${content}`;

  if (signal.url) score += 6;
  if (signal.content.length >= 120) score += 6;

  if (HIGH_SIGNAL_SOURCES.some((entry) => source.includes(entry))) {
    score += 10;
  }

  if (LOW_SIGNAL_PATTERNS.some((entry) => combinedText.includes(entry))) {
    score -= 12;
  }

  if (
    /(launch|funding|raised|acquired|partnership|customer|signed|hired|appointed|pricing)/.test(
      combinedText,
    )
  ) {
    score += 6;
  }

  const detectedAt = signal.detected_at ?? signal.created_at;
  const ageMs = Date.now() - new Date(detectedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 2) score += 10;
  else if (ageDays <= 7) score += 6;
  else if (ageDays <= 30) score += 2;
  else score -= 4;

  const normalized = Math.max(0, Math.min(100, score));
  const tier =
    normalized >= 60 ? "high" : normalized >= 30 ? "medium" : "low";

  return { score: normalized, tier };
}

export function enrichSignalsWithPriority<T extends Signal>(signals: T[]): T[] {
  return signals.map((signal) => {
    const { score, tier } = scoreSignal(signal);
    return {
      ...signal,
      priority_score: score,
      priority_tier: tier,
    };
  });
}

// ---------------------------------------------------------------------------
// Freshness classification (#19)
// ---------------------------------------------------------------------------

export type FreshnessClass = "fresh" | "aging" | "stale";

export function classifyFreshness(
  detectedAt?: string,
  createdAt?: string,
): FreshnessClass {
  const ref = detectedAt ?? createdAt;
  if (!ref) return "aging";

  const ageMs = Date.now() - new Date(ref).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 7) return "fresh";
  if (ageDays <= 30) return "aging";
  return "stale";
}

// ---------------------------------------------------------------------------
// Score a SignalFinding (pre-DB type) by adapting to Signal shape (#23)
// ---------------------------------------------------------------------------

export function scoreSignalFinding(finding: SignalFinding): {
  score: number;
  tier: "high" | "medium" | "low";
} {
  const adapted: Signal = {
    signal_id: "",
    company_id: "",
    signal_type: finding.signal_type,
    source: finding.source ?? "",
    title: finding.title ?? "",
    content: finding.summary ?? "",
    url: finding.url ?? null,
    detected_at: finding.detected_at ?? null,
    created_at: new Date().toISOString(),
  };
  return scoreSignal(adapted);
}
