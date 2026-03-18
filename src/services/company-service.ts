import { createAdminClient } from "@/lib/supabase/admin";
import {
  extractDomain,
  normalizeUrl,
  extractCompanyName,
} from "@/lib/utils/domain";
import type { Company, DiscoveryResult } from "@/lib/types";

export async function storeCompany(
  userId: string,
  websiteUrl: string,
  organizationId: string,
  pageTitle?: string,
): Promise<Company> {
  const supabase = createAdminClient();
  const url = normalizeUrl(websiteUrl);
  const domain = extractDomain(url);

  const { data: existing } = await supabase
    .from("companies")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("domain", domain)
    .limit(1)
    .single();

  if (existing) return existing as Company;

  const companyName = extractCompanyName(pageTitle, domain);

  const { data: inserted, error } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      company_name: companyName,
      website_url: url,
      domain,
      tracking_status: "active",
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to store company: ${error.message}`);
  return inserted as Company;
}

export async function getCompanies(
  organizationId: string,
): Promise<Company[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("tracking_status", "active")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch companies: ${error.message}`);
  return (data ?? []) as Company[];
}

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

export async function updateCompanyFromDiscovery(
  companyId: string,
  discovery: DiscoveryResult,
): Promise<Company> {
  const supabase = createAdminClient();

  const updates: Record<string, unknown> = {};
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

export async function deleteCompany(companyId: string): Promise<void> {
  const supabase = createAdminClient();

  await supabase.from("signals").delete().eq("company_id", companyId);
  await supabase.from("reports").delete().eq("company_id", companyId);
  const { error } = await supabase
    .from("companies")
    .delete()
    .eq("company_id", companyId);

  if (error) throw new Error(`Failed to delete company: ${error.message}`);
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

export async function checkCompanyDomain(
  organizationId: string,
  domain: string,
): Promise<Company | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("domain", domain)
    .eq("tracking_status", "active")
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to check domain: ${error.message}`);
  }
  return (data as Company) ?? null;
}
