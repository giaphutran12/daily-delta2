import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getReports, getAllReports } from "@/services/report-service";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const companyId = req.nextUrl.searchParams.get("company_id");

    if (companyId) {
      // Verify company belongs to this org before returning reports
      const admin = (await import("@/lib/supabase/admin")).createAdminClient();
      const { data: company } = await admin
        .from("companies")
        .select("organization_id")
        .eq("company_id", companyId)
        .maybeSingle();
      if (!company || company.organization_id !== ctx.organizationId) {
        return Response.json({ error: "Company not found" }, { status: 404 });
      }
      const reports = await getReports(companyId);
      return Response.json({ reports });
    }

    const reports = await getAllReports(ctx.organizationId);
    return Response.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
