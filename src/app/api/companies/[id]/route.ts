import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getCompanyById, deleteCompany } from "@/services/company-service";

function extractCompanyId(req: NextRequest): string {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.length - 1];
}

export const GET = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const companyId = extractCompanyId(req);
  const company = await getCompanyById(companyId);

  if (!company || company.organization_id !== ctx.organizationId) {
    return Response.json({ error: "Company not found" }, { status: 404 });
  }

  return Response.json({ company });
});

export const DELETE = withOrg(
  async (req: NextRequest, ctx: OrgAuthContext) => {
    const companyId = extractCompanyId(req);
    const company = await getCompanyById(companyId);

    if (!company || company.organization_id !== ctx.organizationId) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    await deleteCompany(companyId);
    return Response.json({ success: true });
  },
);
