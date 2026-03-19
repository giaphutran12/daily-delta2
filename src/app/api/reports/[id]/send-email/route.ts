import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getReportById } from "@/services/report-service";
import { sendReportEmail } from "@/services/email-service";
import { getUserSettings } from "@/services/user-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const POST = withOrg(
  async (
    req: NextRequest,
    ctx: OrgAuthContext,
  ) => {
    try {
      const segments = req.nextUrl.pathname.split("/").filter(Boolean);
      const reportId = segments[2];
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

      const settings = await getUserSettings(ctx.userId);
      const emailTo = settings.email || ctx.userEmail;

      if (!emailTo) {
        return Response.json(
          { error: "No email address configured for this user" },
          { status: 400 },
        );
      }

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

      console.log(
        `[SendEmail] Sending report ${reportId} to ${emailTo} for company ${company.company_name}`,
      );
      const emailSent = await sendReportEmail(emailTo, company, report.report_data);

      if (!emailSent) {
        return Response.json(
          { error: "Failed to send email" },
          { status: 500 },
        );
      }

      return Response.json({ success: true, email: emailTo });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[SendEmail] Error:`, message);
      return Response.json({ error: message }, { status: 500 });
    }
  },
);
