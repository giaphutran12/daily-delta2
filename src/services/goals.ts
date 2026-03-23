export function buildDiscoveryGoal(companyUrl: string): string {
  return `You are a company research agent analyzing the website at ${companyUrl}.

IMPORTANT: Stay ONLY on this company's website. Do NOT visit external sites.

STEP 1 — Navigate to the homepage and get an overview of the company.

STEP 2 — Check these pages if they exist:
- /about or /about-us
- /team or /leadership
- /careers or /jobs
- /pricing
- /blog or /news
- /products or /solutions

STEP 3 — Extract this structured information:
- Company name
- Company description (2-3 sentences)
- Industry/sector
- Products or services offered
- Headquarters location
- Founding year (if mentioned)
- Company size estimate (startup, small, medium, large)
- Key leadership names and titles
- Careers page URL
- Blog/news page URL
- Pricing page URL
- Pricing model summary

STEP 4 — Return your findings as JSON:
{
  "company_name": "...",
  "description": "...",
  "industry": "...",
  "products": ["product1", "product2"],
  "headquarters": "...",
  "founding_year": null,
  "company_size": "...",
  "leadership": ["Name - Title"],
  "careers_url": "...",
  "blog_url": "...",
  "pricing_url": "...",
  "pricing_model": "..."
}

Be fast and factual. Do not invent information. If something is not found, use null or empty array.`;
}
