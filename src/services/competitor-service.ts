import { createAdminClient } from "@/lib/supabase/admin";
import type { Company, CompetitorLink } from "@/lib/types";
import { searchCompanyCatalog } from "@/services/company-service";

function rowToCompetitorLink(row: Record<string, unknown>): CompetitorLink {
  return {
    organization_id: row.organization_id as string,
    company_id: row.company_id as string,
    competitor_company_id: row.competitor_company_id as string,
    created_at: row.created_at as string,
    created_by: (row.created_by as string) ?? null,
    competitor: row.competitor as Company,
  };
}

export async function getCompetitors(
  organizationId: string,
  companyId: string,
): Promise<CompetitorLink[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organization_company_competitors")
    .select(`
      organization_id,
      company_id,
      competitor_company_id,
      created_at,
      created_by,
      competitor:companies!organization_company_competitors_competitor_company_id_fkey(*)
    `)
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch competitors: ${error.message}`);
  }

  return (data ?? []).map((row) => rowToCompetitorLink(row as Record<string, unknown>));
}

export async function addCompetitor(
  organizationId: string,
  companyId: string,
  competitorCompanyId: string,
  createdBy: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("organization_company_competitors")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      competitor_company_id: competitorCompanyId,
      created_by: createdBy,
    });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to add competitor: ${error.message}`);
  }
}

export async function removeCompetitor(
  organizationId: string,
  companyId: string,
  competitorCompanyId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("organization_company_competitors")
    .delete()
    .eq("organization_id", organizationId)
    .eq("company_id", companyId)
    .eq("competitor_company_id", competitorCompanyId);

  if (error) {
    throw new Error(`Failed to remove competitor: ${error.message}`);
  }
}

export async function getCompetitorSuggestions(
  company: Company,
  organizationId: string,
  query?: string,
  limit = 12,
): Promise<Company[]> {
  const competitors = await getCompetitors(organizationId, company.company_id);
  const existingIds = new Set(competitors.map((entry) => entry.competitor_company_id));
  existingIds.add(company.company_id);

  const result = await searchCompanyCatalog(
    query,
    {
      industry: query?.trim() ? undefined : company.industry ?? undefined,
      excludeCompanyIds: [...existingIds],
    },
    limit,
    0,
  );

  return result.companies;
}
