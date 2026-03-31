import type { Company } from "@/lib/types";
import { extractDomain } from "@/lib/utils/domain";

const NON_ALPHANUMERIC_REGEX = /[^\p{L}\p{N}]+/gu;
const WHITESPACE_REGEX = /\s+/g;
const DOMAIN_LIKE_REGEX =
  /^(https?:\/\/)?[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+([/?#].*)?$/i;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function normalizeCompanySearchText(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC_REGEX, " ")
    .replace(WHITESPACE_REGEX, " ")
    .trim();
}

export function tokenizeCompanySearchText(value: string): string[] {
  return normalizeCompanySearchText(value).split(" ").filter(Boolean);
}

export function looksLikeWebsiteQuery(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && DOMAIN_LIKE_REGEX.test(trimmed);
}

function getQueryDomain(value: string): string | null {
  if (!looksLikeWebsiteQuery(value)) return null;
  return extractDomain(value).toLowerCase();
}

function getCompanyNameTokens(company: Company): string[] {
  return tokenizeCompanySearchText(company.company_name);
}

function getCompanySearchTokenPool(company: Company): string[] {
  return unique([
    ...tokenizeCompanySearchText(company.company_name),
    ...tokenizeCompanySearchText(company.domain),
    ...tokenizeCompanySearchText(company.website_url),
  ]);
}

function allTokensMatch(queryTokens: string[], candidateTokens: string[]): boolean {
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => candidateToken.includes(queryToken)),
  );
}

export function isExactEnoughCompanyMatch(
  company: Company,
  query: string,
): boolean {
  const normalizedQuery = normalizeCompanySearchText(query);
  if (!normalizedQuery) return false;

  const queryTokens = tokenizeCompanySearchText(query);
  const companyName = normalizeCompanySearchText(company.company_name);
  const companyNameTokens = getCompanyNameTokens(company);
  const queryDomain = getQueryDomain(query);

  if (queryDomain && company.domain.toLowerCase() === queryDomain) {
    return true;
  }

  if (companyName === normalizedQuery) {
    return true;
  }

  if (normalizedQuery.length >= 3 && companyName.startsWith(normalizedQuery)) {
    return true;
  }

  return queryTokens.length >= 2 && allTokensMatch(queryTokens, companyNameTokens);
}

export function scoreCompanySearchMatch(
  company: Company,
  query: string,
): number | null {
  const normalizedQuery = normalizeCompanySearchText(query);
  if (!normalizedQuery) return 0;

  const queryTokens = tokenizeCompanySearchText(query);
  const companyName = normalizeCompanySearchText(company.company_name);
  const companyNameTokens = getCompanyNameTokens(company);
  const allTokens = getCompanySearchTokenPool(company);
  const queryDomain = getQueryDomain(query);

  if (queryDomain && company.domain.toLowerCase() === queryDomain) {
    return 1000;
  }

  if (companyName === normalizedQuery) {
    return 950;
  }

  if (queryDomain && extractDomain(company.website_url).toLowerCase() === queryDomain) {
    return 925;
  }

  if (companyName.startsWith(normalizedQuery)) {
    return 900 - Math.max(companyName.length - normalizedQuery.length, 0);
  }

  if (queryTokens.length >= 2 && allTokensMatch(queryTokens, companyNameTokens)) {
    return 800;
  }

  if (allTokensMatch(queryTokens, allTokens)) {
    return queryTokens.length >= 2 ? 700 : 650;
  }

  return null;
}

export function companyMatchesSearchQuery(company: Company, query: string): boolean {
  return scoreCompanySearchMatch(company, query) !== null;
}

export function rankCompaniesBySearch(
  companies: Company[],
  query: string | undefined,
  limit?: number,
): Company[] {
  if (!query?.trim()) {
    const sorted = [...companies].sort((a, b) =>
      a.company_name.localeCompare(b.company_name),
    );
    return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
  }

  const ranked = companies
    .map((company) => ({
      company,
      score: scoreCompanySearchMatch(company, query),
    }))
    .filter((entry): entry is { company: Company; score: number } => entry.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.company.company_name.localeCompare(b.company.company_name);
    })
    .map((entry) => entry.company);

  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}
