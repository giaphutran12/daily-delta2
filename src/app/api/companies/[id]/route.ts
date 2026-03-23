import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getCompanyById, isTracking, untrackCompany } from "@/services/company-service";

function extractCompanyId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.length - 1];
}

/**
 * GET /api/companies/[id] — Get company details (must be tracking it)
 */
export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = extractCompanyId(req);
  const company = await getCompanyById(companyId);

  if (!company) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  // Verify the org is tracking this company
  const tracking = await isTracking(ctx.organizationId, companyId);
  if (!tracking) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  return Response.json({ company });
});

/**
 * DELETE /api/companies/[id] — Untrack company (does NOT delete from platform)
 */
export const DELETE = withOrg(
  async (req: NextRequest, ctx: OrgAuthContext) => {
    const companyId = extractCompanyId(req);

    // Verify the org is tracking this company
    const tracking = await isTracking(ctx.organizationId, companyId);
    if (!tracking) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    await untrackCompany(ctx.organizationId, companyId);
    return Response.json({ success: true });
  },
);
