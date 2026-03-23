import { Company } from '../types';

interface TemplateContext {
  company_name: string;
  domain: string;
  website_url: string;
  blog_url: string;
  careers_url: string;
  pricing_url: string;
}

/**
 * Build template context from company data with fallback URLs
 */
export function buildTemplateContext(company: Company): TemplateContext {
  const baseUrl = company.website_url;
  return {
    company_name: company.company_name,
    domain: company.domain,
    website_url: baseUrl,
    blog_url: company.blog_url || `${baseUrl}/blog`,
    careers_url: company.careers_url || `${baseUrl}/careers`,
    pricing_url: company.pricing_url || `${baseUrl}/pricing`,
  };
}

/**
 * Resolve {placeholder} tokens in a string against company data
 */
export function resolveTemplate(template: string, company: Company): string {
  const ctx = buildTemplateContext(company);
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    return (ctx as unknown as Record<string, string>)[key] ?? `{${key}}`;
  });
}

/**
 * Build a full TinyFish goal prompt from structured signal definition fields
 */
export function buildGoalFromDefinition(
  name: string,
  resolvedTargetUrl: string,
  searchInstructions: string,
  signalType: string,
  companyName: string,
): string {
  return `You are a ${name} agent for ${companyName}.

Navigate to: ${resolvedTargetUrl}

TASK: ${searchInstructions}

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

IMPORTANT: For detected_at, use the actual date this information came up or event happneed. Do NOT use today's date. If no date is visible, omit the field.
Only include genuinely meaningful findings. Be factual.`;
}
