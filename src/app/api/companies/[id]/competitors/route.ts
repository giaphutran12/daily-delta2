import { after, NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import type { DiscoveryResult } from "@/lib/types";
import {
  addCompanyToPlatform,
  getCompanyById,
  isTracking,
  trackCompany,
} from "@/services/company-service";
import {
  addCompetitor,
  getCompetitorSuggestions,
  getCompetitors,
  removeCompetitor,
} from "@/services/competitor-service";
import { enqueuePipelineRequestedEvent } from "@/services/pipeline-request-service";
import { runDiscoveryAgent } from "@/services/orchestrator";
import { setCompanyPlatformStatus, updateCompanyFromDiscovery } from "@/services/company-service";
import { normalizeUrl } from "@/lib/utils/domain";

export const maxDuration = 800;

function extractCompanyId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.indexOf("companies") + 1];
}

function needsRefresh(lastRun: string | null): boolean {
  if (!lastRun) return true;
  const ageMs = Date.now() - new Date(lastRun).getTime();
  return ageMs >= 7 * 24 * 60 * 60 * 1000;
}

async function refreshCompetitorCompany(
  companyId: string,
  websiteUrl: string,
  shouldRunDiscovery: boolean,
): Promise<void> {
  try {
    if (shouldRunDiscovery) {
      await setCompanyPlatformStatus(companyId, "enriching");
      const result = await runDiscoveryAgent(websiteUrl);
      if (result && typeof result === "object") {
        await updateCompanyFromDiscovery(companyId, result as DiscoveryResult);
      } else {
        await setCompanyPlatformStatus(companyId, "active");
      }
    }

    await enqueuePipelineRequestedEvent({
      source: "refresh",
      companyIds: [companyId],
    });
  } catch (error) {
    console.error("[COMPETITOR] Failed background refresh:", error);
    try {
      await setCompanyPlatformStatus(companyId, "active");
    } catch {}
  }
}

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = extractCompanyId(req);
  const company = await getCompanyById(companyId);

  if (!company) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const [competitors, suggestions] = await Promise.all([
    getCompetitors(ctx.organizationId, companyId),
    getCompetitorSuggestions(company, ctx.organizationId),
  ]);

  return Response.json({
    competitors,
    suggestions,
  });
});

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = extractCompanyId(req);
  const company = await getCompanyById(companyId);

  if (!company) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const body = (await req.json()) as {
    competitor_company_id?: string;
    website_url?: string;
    page_title?: string;
  };

  let competitor = body.competitor_company_id
    ? await getCompanyById(body.competitor_company_id)
    : null;
  let shouldRunDiscovery = false;

  if (!competitor && body.website_url) {
    const stored = await addCompanyToPlatform(
      normalizeUrl(body.website_url),
      ctx.userId,
      body.page_title,
    );
    competitor = stored.company;
    shouldRunDiscovery = !stored.already_existed;
  }

  if (!competitor) {
    return Response.json(
      { error: "competitor_company_id or website_url is required" },
      { status: 400 },
    );
  }

  if (competitor.company_id === companyId) {
    return Response.json(
      { error: "A company cannot be its own competitor" },
      { status: 400 },
    );
  }

  try {
    await trackCompany(ctx.organizationId, competitor.company_id, ctx.userId);
    await addCompetitor(
      ctx.organizationId,
      companyId,
      competitor.company_id,
      ctx.userId,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add competitor";

    return Response.json(
      { error: message },
      {
        status: message.startsWith("Tracking limit reached") ? 400 : 500,
      },
    );
  }

  const refreshQueued =
    shouldRunDiscovery || needsRefresh(competitor.last_agent_run);

  if (refreshQueued) {
    after(async () => {
      await refreshCompetitorCompany(
        competitor.company_id,
        competitor.website_url,
        shouldRunDiscovery,
      );
    });
  }

  return Response.json({
    success: true,
    competitor,
    refreshQueued,
  });
});

export const DELETE = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = extractCompanyId(req);
  const competitorCompanyId = req.nextUrl.searchParams.get("competitor_company_id");

  if (!competitorCompanyId) {
    return Response.json(
      { error: "competitor_company_id is required" },
      { status: 400 },
    );
  }

  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  await removeCompetitor(ctx.organizationId, companyId, competitorCompanyId);
  return Response.json({ success: true });
});
