import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getCompanyById, isTracking } from "@/services/company-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { enrichSignalsWithPriority } from "@/services/signal-scoring";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = req.nextUrl.searchParams.get("company_id");
  const companyIdsParam = req.nextUrl.searchParams.get("company_ids");

  const companyIds = companyIdsParam
    ? companyIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : companyId
      ? [companyId]
      : [];

  if (companyIds.length === 0) {
    return Response.json(
      { error: "company_id or company_ids is required" },
      { status: 400 },
    );
  }

  const trackingChecks = await Promise.all(
    companyIds.map((id) => isTracking(ctx.organizationId, id)),
  );
  if (trackingChecks.some((tracking) => !tracking)) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "200", 10),
    500,
  );
  const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0", 10);

  const supabase = createAdminClient();
  const { data, error, count } = await supabase
    .from("signals")
    .select("*", { count: "exact" })
    .in("company_id", companyIds)
    .order("detected_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const companies = await Promise.all(companyIds.map((id) => getCompanyById(id)));
  const companyMap = new Map(
    companies
      .filter((company): company is NonNullable<typeof company> => !!company)
      .map((company) => [
        company.company_id,
        {
          company_id: company.company_id,
          company_name: company.company_name,
          industry: company.industry,
          website_url: company.website_url,
        },
      ]),
  );

  const scoredSignals = enrichSignalsWithPriority(
    (data ?? []).map((signal) => ({
      ...signal,
      company: companyMap.get(signal.company_id as string),
    })),
  );

  return Response.json({
    signals: scoredSignals,
    total: count ?? 0,
  });
});
