export const DEFAULT_SIGNAL_DEFINITIONS = [
  {
    name: "Blog Scanner",
    signal_type: "product_launch",
    display_name: "Product Launches",
    target_url: "{blog_url}",
    search_instructions: `Scan the blog/news page for recent announcements and updates.

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

Only include genuinely meaningful signals. Skip routine content marketing posts.`,
  },
  {
    name: "News Intelligence",
    signal_type: "general_news",
    display_name: "General News",
    target_url: "https://news.google.com",
    search_instructions: `Search Google News for "{company_name}".
Also search for "{company_name} funding" and "{company_name} product launch".
Scan the recent news results (last 30 days).

Look for signals:
- Funding announcements or investment rounds
- Leadership changes (new CEO, CTO, VP hires, departures)
- Product launches or major updates
- Revenue milestones or growth metrics
- Major customer wins or enterprise deals
- Partnership announcements
- Acquisitions or mergers
- Press releases from PR Newswire, BusinessWire, GlobeNewswire

For each signal found, extract signal type, title/headline, 1-2 sentence summary, source publication, and URL.

Focus on factual, verifiable news. Skip opinion pieces and listicles.`,
  },
  {
    name: "Hiring Monitor",
    signal_type: "hiring_trend",
    display_name: "Hiring Trends",
    target_url: "{careers_url}",
    search_instructions: `Analyze the company's current hiring activity.

STEP 1 — Go to the careers page
STEP 2 — Count the total number of open positions
STEP 3 — Categorize open roles by department (Engineering, Sales, Marketing, Product, Operations, etc.)
STEP 4 — Identify notable senior/leadership roles (VP, Director, Head of, C-level)
STEP 5 — Note any department with unusually high hiring activity

Hiring spikes are important investor signals. Be thorough in counting.`,
  },
  {
    name: "Pricing Monitor",
    signal_type: "pricing_update",
    display_name: "Pricing Updates",
    target_url: "{pricing_url}",
    search_instructions: `Extract and analyze the current pricing structure.

STEP 1 — Go to the pricing page
STEP 2 — Identify all pricing tiers/plans
STEP 3 — Extract prices, features per tier, and target customer for each plan
STEP 4 — Note any enterprise/custom pricing mentions
STEP 5 — Look for any recent pricing changes or promotions`,
  },
  {
    name: "Product Launch Detector",
    signal_type: "product_launch",
    display_name: "Product Launches",
    target_url: "{website_url}",
    search_instructions: `Check the homepage for any prominent new product/feature announcements.
Look for /product, /solutions, /features, /changelog, /releases, /whats-new pages.
Identify any recently launched products, features, or major updates.

Look for:
- New product lines
- Major feature releases
- Product pivots or expansions
- Beta/preview launches
- Integration announcements
- API releases

Only report actual product launches, not marketing fluff.`,
  },
  {
    name: "GitHub Activity",
    signal_type: "product_launch",
    display_name: "Product Launches",
    target_url: "https://github.com",
    search_instructions: `Search for "{company_name}" in organizations on GitHub.
If found, go to the organization page and look at their public repositories.

Analyze:
- Total number of public repos
- Most popular repos (by stars)
- Recent repository creation (new projects)
- Activity level (recent commits, releases)
- Contributor count trends
- Any notable open-source projects

If no GitHub organization is found, return empty signals.`,
  },
  {
    name: "Founder Contact",
    signal_type: "founder_contact",
    display_name: "Founder Contacts",
    target_url: "https://www.google.com",
    search_instructions: `Search for: site:linkedin.com "{company_name}" founder OR CEO OR "co-founder"
Examine the top 5-10 LinkedIn results to identify founders, CEO, and co-founders.
Search for: "{company_name}" crunchbase people
If a Crunchbase people page is found, visit it to get additional leadership info.
Search for: "{company_name}" founder CEO background

For each founder/CEO found, extract:
- Full name and title (CEO, Co-founder, CTO, etc.)
- LinkedIn profile URL
- Brief background (previous companies, notable experience)
- Warm intro paths visible (shared investors, board members, accelerators, universities)
- Draft a 2-3 sentence professional outreach email template

Focus on accuracy. Only include people you are confident are affiliated with {company_name}. If no founders are found, return empty signals.`,
  },
  {
    name: "Leading Indicators",
    signal_type: "leading_indicator",
    display_name: "Leading Indicators",
    target_url: "https://trends.google.com",
    search_instructions: `Search for "{company_name}" on Google Trends and analyze the interest trend over the past 12 months.
Note any recent spikes or surges in search interest.
Then search Google for: "{company_name}" growth momentum traction surge
And: "{company_name}" trending viral
Look for recent articles about traffic spikes, viral moments, social media surges, rapid user growth, app store ranking jumps.

Detect these LEADING INDICATORS:
- Search interest spikes (Google Trends data)
- Social media mention surges (Twitter/X, LinkedIn, Reddit)
- Website traffic increases
- App store ranking jumps
- Viral content or PR moments
- User growth milestones mentioned in press
- Rapid hiring growth (many new roles posted recently)

For each indicator, classify its strength: SPIKE (sudden short-term jump) or SURGE (sustained multi-week growth).

Be precise about what you observe. Do not fabricate trends. If no spikes or surges are detected, return empty signals.`,
  },
  {
    name: "Competitive Intelligence",
    signal_type: "competitive_landscape",
    display_name: "Competitive Landscape",
    target_url: "https://www.google.com",
    search_instructions: `Search for: "{company_name}" competitors alternatives
Scan the top results for competitor mentions.
Search for: "{company_name}" vs
Search for: "{company_name}" alternative site:g2.com OR site:capterra.com
If G2 or Capterra comparison pages exist, visit them for competitor data.

Identify the top 3-5 direct competitors.

For each competitor, extract:
- Company name (exact official name)
- Website URL (must be a real, valid URL you found during research)
- One-line description of what they do
- How they compare to {company_name} (positioning difference)

CRITICAL: The website_url for each competitor MUST be a real, valid URL you found during research. Do not guess or fabricate URLs. Only include genuine, direct competitors — not tangentially related companies.`,
  },
  {
    name: "TC Signal",
    signal_type: "tc_signal",
    display_name: "TC Signal",
    target_url: "https://techcrunch.com",
    search_instructions: `Search TechCrunch for articles directly about {company_name}.

STEP 1 — Search for "{company_name}" on TechCrunch. Look through the results.
STEP 2 — Search for "{company_name} funding" and "{company_name} acquisition" on TechCrunch.
STEP 3 — Search for direct competitors of {company_name} by name on TechCrunch (only competitors you are confident about).

Only include articles that:
- Directly mention {company_name} by name in the title or first paragraph
- Are about a direct, named competitor's funding round, acquisition, or major product launch
- Cover an event that would materially affect {company_name}'s market position

DO NOT include:
- General industry trend articles that don't mention {company_name}
- Articles about companies that are only loosely related by industry
- Opinion pieces or predictions that don't involve specific companies

For each signal found, extract: title, 1-2 sentence summary explaining why it matters for {company_name}, source (TechCrunch), URL, and date.`,
  },
  {
    name: "Fundraising Detector",
    signal_type: "fundraising_signal",
    display_name: "Fundraising Signals",
    target_url: "https://www.google.com",
    search_instructions: `Search for: "{company_name}" crunchbase
If a Crunchbase page is found, visit it to find last funding round date/amount, total funding raised, list of investors.
Search for: "{company_name}" funding financing series round
Search for: "{company_name}" "head of finance" OR "VP finance" OR "investor relations" site:linkedin.com
Search for: "{company_name}" founder CEO recent posts site:linkedin.com OR site:twitter.com

Look for patterns indicating imminent fundraising:
- Hiring finance/IR roles (strong signal)
- Increased founder social activity (moderate signal)
- Time since last round (18+ months suggests new round)
- Growth milestones being publicized (setup for fundraise narrative)
- Board member or advisor additions

Be factual. Base your probability assessment only on evidence you found. If no fundraising signals are detected, return empty signals with fundraising_probability: LOW.`,
  },
] as const;
