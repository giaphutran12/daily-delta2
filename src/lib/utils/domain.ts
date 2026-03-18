/**
 * Domain extraction and URL normalization utilities
 */

/**
 * Extract clean domain from a URL (strips www. prefix)
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  }
}

/**
 * Ensure URL has https:// protocol prefix
 */
export function normalizeUrl(url: string): string {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return `https://${url}`;
  }
  return url;
}

/**
 * Extract company name from page title or domain.
 * Tries to split on common separators (e.g. " - ", " | "),
 * falls back to capitalizing the domain name.
 */
export function extractCompanyName(
  pageTitle: string | undefined,
  domain: string,
): string {
  if (pageTitle) {
    const separators = [" - ", " | ", " — ", " · ", " :: "];
    for (const sep of separators) {
      if (pageTitle.includes(sep)) {
        return pageTitle.split(sep)[0].trim();
      }
    }
    if (pageTitle.length <= 40) {
      return pageTitle.trim();
    }
  }
  // Fallback: capitalize domain name
  const name = domain.split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
