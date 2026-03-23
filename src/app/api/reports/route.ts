import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getReports, getAllReports } from "@/services/report-service";
import { isTracking } from "@/services/company-service";

/**
 * GET /api/reports?company_id=X (optional filter)
 * Returns reports for companies the org tracks.
 */
export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const companyId = req.nextUrl.searchParams.get("company_id");

    if (companyId) {
      // Verify the org is tracking this company
      const tracking = await isTracking(ctx.organizationId, companyId);
      if (!tracking) {
        return Response.json({ error: "Company not found" }, { status: 404 });
      }
      const reports = await getReports(companyId);
      return Response.json({ reports });
    }

    // Return all reports for tracked companies
    const reports = await getAllReports(ctx.organizationId);
    return Response.json({ reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
