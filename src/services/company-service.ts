import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractDomain,
  normalizeUrl,
  extractCompanyName,
} from "@/lib/utils/domain";
import type { Company, DiscoveryResult, TrackedCompany } from "@/lib/types";

// ---------------------------------------------------------------------------
// Platform Company Operations
// ---------------------------------------------------------------------------

/**
 * Add a company to the platform database.
 * If the domain already exists, returns the existing record.
 * Otherwise creates a new company with pending_discovery status.
 */
export async function addCompanyToPlatform(
  websiteUrl: string,
  addedBy: string,
  pageTitle?: string,
): Promise<{ company: Company; already_existed: boolean }> {
  const supabase = createAdminClient();
  const url = normalizeUrl(websiteUrl);
  const domain = extractDomain(url);

  // Check if domain already exists on platform
  const { data: existing } = await supabase
    .from("companies")
    .select("*")
    .eq("domain", domain)
    .limit(1)
    .single();

  if (existing) return { company: existing as Company, already_existed: true };

  const companyName = extractCompanyName(pageTitle, domain);

  const { data: inserted, error } = await supabase
    .from("companies")
    .insert({
      added_by: addedBy,
      company_name: companyName,
      website_url: url,
      domain,
      tracking_status: "active",
      platform_status: "pending_discovery",
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to store company: ${error.message}`);
  return { company: inserted as Company, already_existed: false };
}

/**
 * Search the platform company catalog.
 */
export async function searchCompanyCatalog(
  query?: string,
  filters?: { industry?: string },
  limit = 50,
  offset = 0,
): Promise<{ companies: Company[]; total: number }> {
  const supabase = createAdminClient();

  let dbQuery = supabase
    .from("companies")
    .select("*", { count: "exact" })
    .eq("tracking_status", "active")
    .order("company_name", { ascending: true });

  if (query && query.trim().length > 0) {
    const q = query.trim();
    dbQuery = dbQuery.or(
      `company_name.ilike.%${q}%,domain.ilike.%${q}%,description.ilike.%${q}%,industry.ilike.%${q}%`,
    );
  }

  if (filters?.industry) {
    dbQuery = dbQuery.ilike("industry", `%${filters.industry}%`);
  }

  dbQuery = dbQuery.range(offset, offset + limit - 1);

  const { data, error, count } = await dbQuery;

  if (error) {
    console.error("[CATALOG] Search failed:", error.message, error.code, error.details);
    throw new Error(`Failed to search catalog: ${error.message}`);
  }
  return {
    companies: (data ?? []) as Company[],
    total: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Tracking Operations (org ↔ company junction)
// ---------------------------------------------------------------------------

/**
 * Get companies tracked by an organization.
 */
export async function getTrackedCompanies(
  organizationId: string,
): Promise<TrackedCompany[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organization_tracked_companies")
    .select("tracked_at, tracked_by, companies(*)")
    .eq("organization_id", organizationId)
    .order("tracked_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch tracked companies: ${error.message}`);

  return (data ?? []).map((row) => {
    const company = row.companies as unknown as Company;
    return {
      ...company,
      tracked_at: row.tracked_at,
      tracked_by: row.tracked_by,
    } as TrackedCompany;
  });
}

/**
 * Track a company for an organization.
 * Enforces the org's tracking_limit.
 */
export async function trackCompany(
  organizationId: string,
  companyId: string,
  trackedBy: string,
): Promise<void> {
  const supabase = createAdminClient();

  // Check tracking limit
  const { data: org } = await supabase
    .from("organizations")
    .select("tracking_limit")
    .eq("organization_id", organizationId)
    .single();

  const limit = org?.tracking_limit ?? 5;

  const { count } = await supabase
    .from("organization_tracked_companies")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);

  if ((count ?? 0) >= limit) {
    throw new Error(`Tracking limit reached (${limit}). Untrack a company first.`);
  }

  const { error } = await supabase
    .from("organization_tracked_companies")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      tracked_by: trackedBy,
    });

  if (error) {
    if (error.code === "23505") return; // Already tracking (unique constraint)
    throw new Error(`Failed to track company: ${error.message}`);
  }
}

/**
 * Untrack a company for an organization.
 */
export async function untrackCompany(
  organizationId: string,
  companyId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("organization_tracked_companies")
    .delete()
    .eq("organization_id", organizationId)
    .eq("company_id", companyId);

  if (error) throw new Error(`Failed to untrack company: ${error.message}`);
}

/**
 * Check if an org is tracking a specific company.
 */
export async function isTracking(
  organizationId: string,
  companyId: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  const { count } = await supabase
    .from("organization_tracked_companies")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("company_id", companyId);

  return (count ?? 0) > 0;
}

/**
 * Get all organization IDs tracking a given company.
 */
export async function getTrackingOrgs(
  companyId: string,
): Promise<string[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organization_tracked_companies")
    .select("organization_id")
    .eq("company_id", companyId);

  if (error) throw new Error(`Failed to get tracking orgs: ${error.message}`);
  return (data ?? []).map((r) => r.organization_id);
}

/**
 * Get all active companies that are tracked by at least one org.
 */
export async function getTrackedActiveCompanies(): Promise<Company[]> {
  const supabase = createAdminClient();

  // Get distinct company IDs from tracking table
  const { data: tracked, error: trackError } = await supabase
    .from("organization_tracked_companies")
    .select("company_id");

  if (trackError) throw new Error(`Failed to load tracked companies: ${trackError.message}`);
  if (!tracked || tracked.length === 0) return [];

  const companyIds = [...new Set(tracked.map((t) => t.company_id))];

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .in("company_id", companyIds)
    .eq("tracking_status", "active");

  if (error) throw new Error(`Failed to fetch companies: ${error.message}`);
  return (data ?? []) as Company[];
}

// ---------------------------------------------------------------------------
// Single Company Operations (no org scoping needed)
// ---------------------------------------------------------------------------

export async function getCompanyById(
  companyId: string,
): Promise<Company | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("company_id", companyId)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch company: ${error.message}`);
  }
  return (data as Company) ?? null;
}

export async function getCompaniesByIds(
  companyIds: string[],
): Promise<Company[]> {
  if (companyIds.length === 0) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .in("company_id", companyIds);

  if (error) {
    throw new Error(`Failed to fetch companies: ${error.message}`);
  }

  return (data ?? []) as Company[];
}

export async function updateCompanyFromDiscovery(
  companyId: string,
  discovery: DiscoveryResult,
): Promise<Company> {
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = {
    platform_status: "active",
  };
  if (discovery.company_name) updates.company_name = discovery.company_name;
  if (discovery.description) updates.description = discovery.description;
  if (discovery.industry) updates.industry = discovery.industry;
  if (discovery.founding_year) updates.founding_year = discovery.founding_year;
  if (discovery.headquarters) updates.headquarters = discovery.headquarters;
  if (discovery.company_size) updates.company_size = discovery.company_size;
  if (discovery.products) updates.detected_products = discovery.products;
  if (discovery.careers_url) updates.careers_url = discovery.careers_url;
  if (discovery.blog_url) updates.blog_url = discovery.blog_url;
  if (discovery.pricing_url) updates.pricing_url = discovery.pricing_url;

  const { data, error } = await supabase
    .from("companies")
    .update(updates)
    .eq("company_id", companyId)
    .select("*")
    .single();

  if (error) throw new Error(`Failed to update company: ${error.message}`);
  return data as Company;
}

export async function setCompanyPlatformStatus(
  companyId: string,
  status: Company["platform_status"],
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("companies")
    .update({ platform_status: status })
    .eq("company_id", companyId);
  if (error) throw new Error(`Failed to update platform_status: ${error.message}`);
}

export async function updateLastAgentRun(companyId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("companies")
    .update({ last_agent_run: new Date().toISOString() })
    .eq("company_id", companyId);

  if (error)
    throw new Error(`Failed to update last_agent_run: ${error.message}`);
}
