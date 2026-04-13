// "current" means the repo's TinyFish REST search path. The name is vague,
// but callers depend on it, so keep the compatibility label here for now.
export type SearchProvider = "current" | "exa" | "agent";
export type FetchProvider = "raw" | "exa";

export type PipelineBenchmarkMode =
  | "legacy_tinyfish_agents"
  | "current_search_raw_fetch"
  | "exa_search_raw_fetch"
  | "exa_search_exa_fetch"
  | "exa_search_exa_fetch_skip_llm_dedup";

const SEARCH_ENGINE_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "news.google.com",
  "techcrunch.com",
  "www.techcrunch.com",
  "github.com",
  "www.github.com",
  "trends.google.com",
]);

export function isSearchBasedDefinition(targetUrl: string): boolean {
  try {
    const host = new URL(targetUrl).hostname;
    return SEARCH_ENGINE_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function getDefaultSearchProvider(): SearchProvider {
  const value = process.env.DAILY_DELTA_SEARCH_PROVIDER?.trim().toLowerCase();
  if (value === "current" || value === "exa" || value === "agent") return value;
  return "exa";
}

export function getDefaultFetchProvider(): FetchProvider {
  const value = process.env.DAILY_DELTA_FETCH_PROVIDER?.trim().toLowerCase();
  if (value === "exa") return "exa";
  return "raw";
}
