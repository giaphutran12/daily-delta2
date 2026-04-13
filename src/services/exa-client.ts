export interface ExaSearchItem {
  id?: string;
  title?: string;
  url: string;
  publishedDate?: string;
  author?: string;
  text?: string;
}

interface ExaSearchResponse {
  results?: ExaSearchItem[];
}

interface ExaContentsStatus {
  id: string;
  status: "success" | "error";
  error?: {
    tag?: string;
    httpStatusCode?: number;
  };
}

interface ExaContentsResponse {
  results?: ExaSearchItem[];
  statuses?: ExaContentsStatus[];
}

export interface ExaContentsItem {
  url: string;
  title: string | null;
  text: string;
  publishedDate?: string;
  error?: string;
}

const EXA_API_BASE = "https://api.exa.ai";

function getExaApiKey(): string {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set");
  return key;
}

async function exaRequest<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${EXA_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getExaApiKey(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Exa ${path} failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export async function exaSearch(
  query: string,
  options?: { numResults?: number },
): Promise<ExaSearchItem[]> {
  const payload = {
    query,
    numResults: options?.numResults ?? 5,
  };

  const data = await exaRequest<ExaSearchResponse>("/search", payload);
  return (data.results ?? []).filter(
    (item): item is ExaSearchItem => typeof item.url === "string" && item.url.length > 0,
  );
}

export async function exaGetContents(
  urls: string[],
): Promise<ExaContentsItem[]> {
  if (urls.length === 0) return [];

  const data = await exaRequest<ExaContentsResponse>("/contents", {
    urls,
    text: {
      verbosity: "standard",
      excludeSections: ["navigation", "footer", "sidebar"],
    },
    livecrawl: "always",
  });

  const statusById = new Map(
    (data.statuses ?? []).map((status) => [
      status.id,
      status.status === "error"
        ? `${status.error?.tag ?? "EXA_CONTENT_ERROR"}${
            status.error?.httpStatusCode ? ` (${status.error.httpStatusCode})` : ""
          }`
        : null,
    ]),
  );

  const results = (data.results ?? []).map((item) => ({
    url: item.url,
    title: item.title ?? null,
    text: typeof item.text === "string" ? item.text : "",
    publishedDate: item.publishedDate,
    error: statusById.get(item.id ?? item.url) ?? statusById.get(item.url) ?? undefined,
  }));

  const seen = new Set(results.map((item) => item.url));
  for (const status of data.statuses ?? []) {
    const key = status.id;
    if (seen.has(key) || status.status !== "error") continue;
    results.push({
      url: key,
      title: null,
      text: "",
      publishedDate: undefined,
      error: `${status.error?.tag ?? "EXA_CONTENT_ERROR"}${
        status.error?.httpStatusCode ? ` (${status.error.httpStatusCode})` : ""
      }`,
    });
  }

  return results;
}
