import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { StoreCompanyRequestSchema } from "@/lib/utils/validation";
import {
  storeCompany,
  getCompanies,
  updateCompanyFromDiscovery,
} from "@/services/company-service";
import { createSSEStream } from "@/lib/utils/sse";
import type { DiscoveryResult } from "@/lib/types";

export const maxDuration = 800;

export const GET = withOrg(async (_req: NextRequest, ctx: OrgAuthContext) => {
  const companies = await getCompanies(ctx.organizationId);

  const supabase = createAdminClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("company_limit")
    .eq("organization_id", ctx.organizationId)
    .single();

  return Response.json({
    companies,
    company_limit: org?.company_limit ?? 5,
  });
});

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const body = await req.json();
  const parsed = StoreCompanyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { website_url, page_title } = parsed.data;

  const supabase = createAdminClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("company_limit")
    .eq("organization_id", ctx.organizationId)
    .single();

  const companyLimit = org?.company_limit ?? 5;
  const currentCompanies = await getCompanies(ctx.organizationId);

  if (currentCompanies.length >= companyLimit) {
    return Response.json(
      {
        error: "Company limit reached",
        company_limit: companyLimit,
        current_count: currentCompanies.length,
      },
      { status: 403 },
    );
  }

  const { response, sendEvent, close } = createSSEStream();

  (async () => {
    try {
      const company = await storeCompany(
        ctx.userId,
        website_url,
        ctx.organizationId,
        page_title,
      );

      await sendEvent({ type: "company_stored", data: company });

      await sendEvent({
        type: "pipeline_complete",
        data: { message: "Company stored", company },
      });

      // TODO(T6): Wire up actual TinyFish discovery agent call
      runDiscoveryInBackground(company.company_id, company.website_url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await sendEvent({ type: "pipeline_error", data: { error: message } });
    } finally {
      await close();
    }
  })();

  return response;
});

async function runDiscoveryInBackground(
  companyId: string,
  websiteUrl: string,
): Promise<void> {
  try {
    console.log(
      `[Discovery] Starting background enrichment for ${websiteUrl}`,
    );

    // TODO(T6): Replace with actual TinyFish discovery agent call
    const discoveryResult: DiscoveryResult | null = null;

    if (discoveryResult) {
      await updateCompanyFromDiscovery(companyId, discoveryResult);
      console.log(`[Discovery] Enriched company ${companyId}`);
    }
  } catch (err) {
    console.error("[Discovery] Background enrichment failed:", err);
  }
}
