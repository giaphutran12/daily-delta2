import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { AddCompanyRequestSchema } from "@/lib/utils/validation";
import {
  addCompanyToPlatform,
  getTrackedCompanies,
  trackCompany,
  updateCompanyFromDiscovery,
  setCompanyPlatformStatus,
} from "@/services/company-service";
import { getOrganizationTrackingLimit } from "@/services/organization-service";
import { runDiscoveryAgent } from "@/services/orchestrator";
import { createSSEStream } from "@/lib/utils/sse";
import type { DiscoveryResult } from "@/lib/types";

export const maxDuration = 800;

/**
 * GET /api/companies — List companies tracked by the org
 */
export const GET = withOrg(async (_req: NextRequest, ctx: OrgAuthContext) => {
  const companies = await getTrackedCompanies(ctx.organizationId);
  const trackingLimit = await getOrganizationTrackingLimit(ctx.organizationId);

  return Response.json({
    companies,
    tracking_limit: trackingLimit,
  });
});

/**
 * POST /api/companies — Add company to platform + track it
 * If the company already exists on the platform, just track it.
 * If new, creates it and kicks off background discovery.
 */
export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const body = await req.json();
  const parsed = AddCompanyRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { website_url, page_title } = parsed.data;

  const { response, sendEvent, close } = createSSEStream();

  (async () => {
    try {
      // 1. Add to platform (or get existing)
      const { company, already_existed } = await addCompanyToPlatform(
        website_url,
        ctx.userId,
        page_title,
      );

      // 2. Track it for this org (enforces tracking limit)
      await trackCompany(ctx.organizationId, company.company_id, ctx.userId);

      await sendEvent({ type: "company_stored", data: { ...company, already_existed } });
      await sendEvent({
        type: "pipeline_complete",
        data: { message: "Company added and tracked", company },
      });

      // 3. If new company, run discovery (awaited to keep Vercel function alive)
      if (!already_existed) {
        await runDiscoveryInBackground(company.company_id, company.website_url, sendEvent);
      }
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
  sendEvent: (event: { type: string; data: unknown }) => Promise<void>,
): Promise<void> {
  try {
    await setCompanyPlatformStatus(companyId, "enriching");
    await sendEvent({ type: "discovery_started", data: { companyId } });

    console.log(`[Discovery] Starting background enrichment for ${websiteUrl}`);
    const result = await runDiscoveryAgent(websiteUrl);

    let enriched = false;
    if (result && typeof result === "object") {
      const discoveryResult = result as DiscoveryResult;
      if (discoveryResult.company_name || discoveryResult.description || discoveryResult.industry) {
        await updateCompanyFromDiscovery(companyId, discoveryResult);
        enriched = true;
        console.log(`[Discovery] Enriched company ${companyId}`);
      } else {
        await setCompanyPlatformStatus(companyId, "active");
        console.log(`[Discovery] No meaningful data returned for ${companyId}`);
      }
    } else {
      await setCompanyPlatformStatus(companyId, "active");
    }

    await sendEvent({ type: "discovery_complete", data: { companyId, enriched } });
  } catch (err) {
    console.error("[Discovery] Background enrichment failed:", err);
    await setCompanyPlatformStatus(companyId, "active");
  }
}
