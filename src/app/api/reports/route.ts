import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getReports, getAllReports } from "@/services/report-service";

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const companyId = req.nextUrl.searchParams.get("company_id");

    if (companyId) {
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
