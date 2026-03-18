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

export function buildBlogScannerGoal(
  companyName: string,
  blogUrl: string,
): string {
  return `You are a blog/news scanner agent for ${companyName}.

Navigate to: ${blogUrl}

TASK: Scan the blog/news page for recent announcements and updates.

Look for:
- Product launch announcements
- Feature updates or releases
- Company milestones
- Partnership announcements
- Customer case studies or wins
- Funding or investment news
- Leadership or team announcements

STEP 1 — Go to the blog/news page
STEP 2 — Scan the most recent 10-15 posts/articles
STEP 3 — For each relevant post, extract title, date, and a 1-2 sentence summary
STEP 4 — Categorize each finding as one of: product_launch, financing, leadership_change, revenue_milestone, customer_win, partnership, general_news

Return JSON:
{
  "signals": [
    {
      "signal_type": "product_launch",
      "title": "...",
      "summary": "...",
      "source": "company_blog",
      "url": "...",
      "detected_at": "YYYY-MM-DD"
    }
  ]
}

IMPORTANT: For detected_at, use the actual publication date of the article/post (e.g. "2025-12-15"). Do NOT use today's date. If no date is visible, omit the field.

Only include genuinely meaningful signals. Skip routine content marketing posts.`;
}

export function buildNewsScannerGoal(companyName: string): string {
  return `You are a news intelligence agent researching ${companyName}.

STEP 1 — Go to Google News: https://news.google.com
STEP 2 — Search for "${companyName}"
STEP 3 — Also search for "${companyName} funding" and "${companyName} product launch"
STEP 4 — Scan the recent news results (last 30 days)

Look for signals:
- Funding announcements or investment rounds
- Leadership changes (new CEO, CTO, VP hires, departures)
- Product launches or major updates
- Revenue milestones or growth metrics
- Major customer wins or enterprise deals
- Partnership announcements
- Acquisitions or mergers
- Press releases from PR Newswire, BusinessWire, GlobeNewswire

For each signal found, extract:
- Signal type
- Title/headline
- 1-2 sentence summary
- Source publication
- URL

Return JSON:
{
  "signals": [
    {
      "signal_type": "financing",
      "title": "...",
      "summary": "...",
      "source": "TechCrunch",
      "url": "...",
      "detected_at": "YYYY-MM-DD"
    }
  ]
}

IMPORTANT: For detected_at, use the actual publication date of the article (e.g. "2025-12-15"). Do NOT use today's date. If no date is visible, omit the field.

Focus on factual, verifiable news. Skip opinion pieces and listicles.`;
}

export function buildHiringMonitorGoal(
  companyName: string,
  careersUrl: string,
): string {
  return `You are a hiring trends monitor for ${companyName}.

Navigate to: ${careersUrl}

TASK: Analyze the company's current hiring activity.

STEP 1 — Go to the careers page
STEP 2 — Count the total number of open positions
STEP 3 — Categorize open roles by department (Engineering, Sales, Marketing, Product, Operations, etc.)
STEP 4 — Identify notable senior/leadership roles (VP, Director, Head of, C-level)
STEP 5 — Note any department with unusually high hiring activity

Return JSON:
{
  "signals": [
    {
      "signal_type": "hiring_trend",
      "title": "Hiring activity at ${companyName}",
      "summary": "X open positions detected. Notable: Y engineering roles, Z leadership positions.",
      "source": "careers_page",
      "url": "${careersUrl}",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "total_open_roles": 0,
    "departments": {
      "engineering": 0,
      "sales": 0,
      "marketing": 0,
      "product": 0,
      "operations": 0,
      "other": 0
    },
    "notable_roles": ["VP Engineering", "Head of Sales"]
  }
}

Hiring spikes are important investor signals. Be thorough in counting.`;
}

export function buildPricingMonitorGoal(
  companyName: string,
  pricingUrl: string,
): string {
  return `You are a pricing monitor agent for ${companyName}.

Navigate to: ${pricingUrl}

TASK: Extract and analyze the current pricing structure.

STEP 1 — Go to the pricing page
STEP 2 — Identify all pricing tiers/plans
STEP 3 — Extract prices, features per tier, and target customer for each plan
STEP 4 — Note any enterprise/custom pricing mentions
STEP 5 — Look for any recent pricing changes or promotions

Return JSON:
{
  "signals": [
    {
      "signal_type": "pricing_update",
      "title": "Current pricing structure for ${companyName}",
      "summary": "X tiers detected. Plans range from $Y/mo to $Z/mo. Enterprise plan available.",
      "source": "pricing_page",
      "url": "${pricingUrl}",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "tiers": [
      {
        "name": "Starter",
        "price": "$X/mo",
        "target": "Small teams",
        "key_features": ["feature1", "feature2"]
      }
    ],
    "has_enterprise": true,
    "has_free_tier": false
  }
}`;
}

export function buildProductLaunchGoal(
  companyName: string,
  websiteUrl: string,
): string {
  return `You are a product launch detector for ${companyName}.

STEP 1 — Navigate to ${websiteUrl}
STEP 2 — Check the homepage for any prominent new product/feature announcements
STEP 3 — Look for /product, /solutions, /features, /changelog, /releases, /whats-new pages
STEP 4 — Identify any recently launched products, features, or major updates

Look for:
- New product lines
- Major feature releases
- Product pivots or expansions
- Beta/preview launches
- Integration announcements
- API releases

Return JSON:
{
  "signals": [
    {
      "signal_type": "product_launch",
      "title": "...",
      "summary": "...",
      "source": "company_website",
      "url": "...",
      "detected_at": "YYYY-MM-DD"
    }
  ]
}

IMPORTANT: For detected_at, use the actual date the product was launched or announced. Do NOT use today's date. If no date is visible, omit the field.

Only report actual product launches, not marketing fluff.`;
}

export function buildGitHubActivityGoal(companyName: string): string {
  return `You are a GitHub activity monitor for ${companyName}.

STEP 1 — Go to https://github.com
STEP 2 — Search for "${companyName}" in organizations
STEP 3 — If found, go to the organization page
STEP 4 — Look at their public repositories

Analyze:
- Total number of public repos
- Most popular repos (by stars)
- Recent repository creation (new projects)
- Activity level (recent commits, releases)
- Contributor count trends
- Any notable open-source projects

Return JSON:
{
  "signals": [
    {
      "signal_type": "product_launch",
      "title": "...",
      "summary": "...",
      "source": "github",
      "url": "...",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "org_found": true,
    "org_url": "...",
    "total_public_repos": 0,
    "top_repos": [
      { "name": "...", "stars": 0, "language": "...", "description": "..." }
    ],
    "recent_activity": "high/medium/low"
  }
}

If no GitHub organization is found, return empty signals array with org_found: false.`;
}

export function buildFounderContactGoal(companyName: string): string {
  return `You are a founder/leadership research agent for ${companyName}.

STEP 1 — Go to https://www.google.com
STEP 2 — Search for: site:linkedin.com "${companyName}" founder OR CEO OR "co-founder"
STEP 3 — Examine the top 5-10 LinkedIn results to identify founders, CEO, and co-founders
STEP 4 — Search for: "${companyName}" crunchbase people
STEP 5 — If a Crunchbase people page is found, visit it to get additional leadership info
STEP 6 — Search for: "${companyName}" founder CEO background

For each founder/CEO found, extract:
- Full name and title (CEO, Co-founder, CTO, etc.)
- LinkedIn profile URL
- Brief background (previous companies, notable experience)
- Warm intro paths visible (shared investors, board members, accelerators, universities)
- Draft a 2-3 sentence professional outreach email template

Return JSON:
{
  "signals": [
    {
      "signal_type": "founder_contact",
      "title": "John Doe — CEO & Co-founder",
      "summary": "LinkedIn: https://linkedin.com/in/johndoe. Previously founded XYZ Corp (acq. by ABC). Stanford MBA. Warm intro paths: Sequoia Capital (shared investor), YC W21. Draft outreach: Hi John, I came across ${companyName} and was impressed by your approach to [product area]. Would love to connect and learn more about your vision.",
      "source": "linkedin_search",
      "url": "https://linkedin.com/in/johndoe",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "founders_found": 2
  }
}

Focus on accuracy. Only include people you are confident are affiliated with ${companyName}. If no founders are found, return empty signals.`;
}

export function buildLeadingIndicatorsGoal(companyName: string): string {
  return `You are a leading indicators analyst for ${companyName}.

STEP 1 — Go to https://trends.google.com
STEP 2 — Search for "${companyName}" and analyze the interest trend over the past 12 months
STEP 3 — Note any recent spikes or surges in search interest
STEP 4 — Go to https://www.google.com
STEP 5 — Search for: "${companyName}" growth momentum traction surge
STEP 6 — Search for: "${companyName}" trending viral
STEP 7 — Look for recent articles about traffic spikes, viral moments, social media surges, rapid user growth, app store ranking jumps

Detect these LEADING INDICATORS:
- Search interest spikes (Google Trends data)
- Social media mention surges (Twitter/X, LinkedIn, Reddit)
- Website traffic increases
- App store ranking jumps
- Viral content or PR moments
- User growth milestones mentioned in press
- Rapid hiring growth (many new roles posted recently)

For each indicator, classify its strength: SPIKE (sudden short-term jump) or SURGE (sustained multi-week growth).

Return JSON:
{
  "signals": [
    {
      "signal_type": "leading_indicator",
      "title": "SPIKE: Google search interest up 3x in last 30 days",
      "summary": "Google Trends shows a significant spike in search interest for ${companyName}, up approximately 300% from baseline. This may indicate a viral moment or product launch gaining traction.",
      "source": "google_trends",
      "url": "https://trends.google.com/...",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "trend_direction": "up/down/stable",
    "spike_detected": true
  }
}

Be precise about what you observe. Do not fabricate trends. If no spikes or surges are detected, return empty signals.`;
}

export function buildCompetitiveAlertingGoal(
  companyName: string,
  websiteUrl: string,
): string {
  return `You are a competitive intelligence agent for ${companyName} (${websiteUrl}).

STEP 1 — Go to https://www.google.com
STEP 2 — Search for: "${companyName}" competitors alternatives
STEP 3 — Scan the top results for competitor mentions
STEP 4 — Search for: "${companyName}" vs
STEP 5 — Search for: "${companyName}" alternative site:g2.com OR site:capterra.com
STEP 6 — If G2 or Capterra comparison pages exist, visit them for competitor data

TASK: Identify the top 3-5 direct competitors for ${companyName}.

For each competitor, extract:
- Company name (exact official name)
- Website URL (must be a real, valid URL you found during research)
- One-line description of what they do
- How they compare to ${companyName} (positioning difference)

Return JSON:
{
  "signals": [
    {
      "signal_type": "competitive_landscape",
      "title": "Top competitors identified for ${companyName}",
      "summary": "CompetitorA (https://competitora.com) — Enterprise-focused alternative. CompetitorB (https://competitorb.com) — SMB-focused competitor. CompetitorC (https://competitorc.com) — Open-source alternative.",
      "source": "competitive_research",
      "url": "",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "competitors": [
      {
        "name": "CompetitorA",
        "website_url": "https://competitora.com",
        "description": "Enterprise-focused alternative"
      }
    ]
  }
}

CRITICAL: The website_url for each competitor MUST be a real, valid URL you found during research. Do not guess or fabricate URLs. Only include genuine, direct competitors — not tangentially related companies.`;
}

export function buildFundraisingDetectorGoal(companyName: string): string {
  return `You are a fundraising probability analyst for ${companyName}.

STEP 1 — Go to https://www.google.com
STEP 2 — Search for: "${companyName}" crunchbase
STEP 3 — If a Crunchbase page is found, visit it to find:
  - Last funding round date and amount
  - Total funding raised
  - List of investors
STEP 4 — Search for: "${companyName}" funding financing series round
STEP 5 — Search for: "${companyName}" "head of finance" OR "VP finance" OR "investor relations" site:linkedin.com
STEP 6 — Search for: "${companyName}" founder CEO recent posts site:linkedin.com OR site:twitter.com
STEP 7 — Look for patterns indicating imminent fundraising:
  - Hiring finance/IR roles (strong signal)
  - Increased founder social activity (moderate signal)
  - Time since last round (18+ months suggests new round)
  - Growth milestones being publicized (setup for fundraise narrative)
  - Board member or advisor additions

Return JSON:
{
  "signals": [
    {
      "signal_type": "fundraising_signal",
      "title": "Fundraising probability: HIGH — multiple indicators detected",
      "summary": "Last round: Series A ($10M) 20 months ago via Crunchbase. Currently hiring Head of Finance on LinkedIn. Founder increased LinkedIn posting frequency in last 30 days. These are strong indicators of an imminent fundraise.",
      "source": "fundraising_analysis",
      "url": "",
      "detected_at": "YYYY-MM-DD"
    }
  ],
  "metadata": {
    "last_round": {
      "type": "Series A",
      "amount": "$10M",
      "date": "2024-05-01"
    },
    "fundraising_probability": "HIGH/MEDIUM/LOW"
  }
}

Be factual. Base your probability assessment only on evidence you found. If no fundraising signals are detected, return empty signals with fundraising_probability: LOW.`;
}
