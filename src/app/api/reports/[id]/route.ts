import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getReportById, deleteReport } from "@/services/report-service";
import { buildReportEmail } from "@/services/email-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const GET = withOrg(
  async (
    req: NextRequest,
    ctx: OrgAuthContext,
  ) => {
    try {
      const reportId = req.nextUrl.pathname.split("/").pop()!;
      const report = await getReportById(reportId);

      if (!report) {
        return Response.json({ error: "Report not found" }, { status: 404 });
      }

      if (report.organization_id !== ctx.organizationId) {
        return Response.json(
          { error: "Report does not belong to this organization" },
          { status: 403 },
        );
      }

      const preview = req.nextUrl.searchParams.get("preview");
      if (preview === "true") {
        const supabase = createAdminClient();
        const { data: company } = await supabase
          .from("companies")
          .select("*")
          .eq("company_id", report.company_id)
          .single();

        if (!company) {
          return Response.json(
            { error: "Company not found" },
            { status: 404 },
          );
        }

        const html = buildReportEmail(company, report.report_data);
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return Response.json({ report });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  },
);

export const DELETE = withOrg(
  async (
    req: NextRequest,
    ctx: OrgAuthContext,
  ) => {
    try {
      const reportId = req.nextUrl.pathname.split("/").pop()!;

      const report = await getReportById(reportId);
      if (!report) {
        return Response.json({ error: "Report not found" }, { status: 404 });
      }

      if (report.organization_id !== ctx.organizationId) {
        return Response.json(
          { error: "Report does not belong to this organization" },
          { status: 403 },
        );
      }

      await deleteReport(reportId);
      return Response.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return Response.json({ error: message }, { status: 500 });
    }
  },
);
