import { createAdminClient } from "@/lib/supabase/admin";
import { SignalDefinition } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToDefinition(row: Record<string, unknown>): SignalDefinition {
  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    company_id: (row.company_id as string) ?? null,
    name: row.name as string,
    signal_type: row.signal_type as string,
    display_name: row.display_name as string,
    target_url: row.target_url as string,
    search_instructions: row.search_instructions as string,
    scope: row.scope as "global" | "company",
    enabled: row.enabled as boolean,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Get signal definitions for an org. Returns global + company-specific definitions.
 * If companyId is provided, includes definitions scoped to that company.
 */
export async function getSignalDefinitions(
  orgId: string,
  companyId?: string,
): Promise<SignalDefinition[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("signal_definitions")
    .select("*")
    .eq("organization_id", orgId)
    .order("sort_order", { ascending: true });

  if (companyId) {
    // Global defs OR company-specific defs for this company
    query = query.or(`scope.eq.global,company_id.eq.${companyId}`);
  } else {
    query = query.eq("scope", "global");
  }

  const { data, error } = await query;
  if (error) throw new Error(`[SIGNAL_DEF] Failed to fetch definitions: ${error.message}`);
  return (data ?? []).map(rowToDefinition);
}

/**
 * Get a single signal definition by id.
 */
export async function getSignalDefinitionById(
  id: string,
): Promise<SignalDefinition | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("signal_definitions")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to fetch definition: ${error.message}`);
  return data ? rowToDefinition(data) : null;
}

/**
 * Create a new signal definition.
 */
export async function createSignalDefinition(
  orgId: string,
  data: {
    name: string;
    signal_type: string;
    display_name: string;
    target_url: string;
    search_instructions: string;
    scope?: "global" | "company";
    company_id?: string | null;
    enabled?: boolean;
    sort_order?: number;
  },
): Promise<SignalDefinition> {
  const supabase = createAdminClient();

  const { data: inserted, error } = await supabase
    .from("signal_definitions")
    .insert({
      organization_id: orgId,
      company_id: data.scope === "company" ? (data.company_id ?? null) : null,
      name: data.name,
      signal_type: data.signal_type,
      display_name: data.display_name,
      target_url: data.target_url,
      search_instructions: data.search_instructions,
      scope: data.scope || "global",
      enabled: data.enabled !== false,
      sort_order: data.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to create definition: ${error.message}`);
  return rowToDefinition(inserted);
}

/**
 * Update a signal definition (partial update).
 */
export async function updateSignalDefinition(
  id: string,
  data: Partial<{
    name: string;
    signal_type: string;
    display_name: string;
    target_url: string;
    search_instructions: string;
    scope: "global" | "company";
    company_id: string | null;
    enabled: boolean;
    sort_order: number;
  }>,
): Promise<SignalDefinition | null> {
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.signal_type !== undefined) updates.signal_type = data.signal_type;
  if (data.display_name !== undefined) updates.display_name = data.display_name;
  if (data.target_url !== undefined) updates.target_url = data.target_url;
  if (data.search_instructions !== undefined) updates.search_instructions = data.search_instructions;
  if (data.scope !== undefined) updates.scope = data.scope;
  if (data.company_id !== undefined) updates.company_id = data.company_id;
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

  const { data: updated, error } = await supabase
    .from("signal_definitions")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to update definition: ${error.message}`);
  return updated ? rowToDefinition(updated) : null;
}

/**
 * Delete a signal definition by id.
 */
export async function deleteSignalDefinition(id: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("signal_definitions")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`[SIGNAL_DEF] Failed to delete definition: ${error.message}`);
}

/**
 * Toggle a signal definition enabled/disabled.
 */
export async function toggleSignalDefinition(
  id: string,
  enabled: boolean,
): Promise<SignalDefinition | null> {
  return updateSignalDefinition(id, { enabled });
}

// ---------------------------------------------------------------------------
// Default Seeding
// ---------------------------------------------------------------------------

/**
 * Seed the 10 default signal definitions into an org.
 * Skips if org already has definitions.
 */
export async function seedDefaultDefinitions(orgId: string): Promise<void> {
  const supabase = createAdminClient();

  // Check if org already has definitions
  const { data: existing, error: checkError } = await supabase
    .from("signal_definitions")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);

  if (checkError) throw new Error(`[SIGNAL_DEF] Seed check failed: ${checkError.message}`);
  if (existing && existing.length > 0) return;

  const defaults = getDefaultDefinitions();
  const now = new Date().toISOString();

  const rows = defaults.map((def, i) => ({
    organization_id: orgId,
    company_id: null,
    name: def.name,
    signal_type: def.signal_type,
    display_name: def.display_name,
    target_url: def.target_url,
    search_instructions: def.search_instructions,
    scope: "global",
    enabled: true,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase.from("signal_definitions").insert(rows);
  if (error) throw new Error(`[SIGNAL_DEF] Failed to seed defaults: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Default Definitions (10 agents)
// ---------------------------------------------------------------------------

function getDefaultDefinitions() {
  return [
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
  ];
}
