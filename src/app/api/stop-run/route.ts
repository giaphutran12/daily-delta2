import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { StopRunRequestSchema } from "@/lib/utils/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompanyById, updateLastAgentRun } from "@/services/company-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import {
  generateReportFromFindings,
  storeReport,
} from "@/services/report-service";
import { generateManualSummary } from "@/services/openrouter-service";
import { sendReportEmail } from "@/services/email-service";
import { getUserSettings } from "@/services/user-service";
import { SignalFinding } from "@/lib/types";

async function storeSignals(
  companyId: string,
  findings: SignalFinding[],
): Promise<void> {
  if (findings.length === 0) return;

  const supabase = createAdminClient();
  const rows = findings.map((f) => ({
    company_id: companyId,
    signal_definition_id: f.signal_definition_id || null,
    signal_type: f.signal_type,
    source: f.source,
    title: f.title,
    content: f.summary,
    url: f.url || null,
    detected_at: f.detected_at || new Date().toISOString(),
  }));

  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    console.error("[StopRun] Signal store failed:", error.message);
  }
}

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const body = await req.json();
    const parsed = StopRunRequestSchema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "Invalid request" },
        { status: 400 },
      );
    }

    const { company_id, findings } = parsed.data;

    const company = await getCompanyById(company_id);
    if (!company) {
      return Response.json({ error: "Company not found" }, { status: 404 });
    }

    if (company.organization_id !== ctx.organizationId) {
      return Response.json(
        { error: "Company does not belong to this organization" },
        { status: 403 },
      );
    }

    const signalFindings: SignalFinding[] = findings.map((f) => ({
      signal_type: f.signal_type || "general_news",
      title: f.title || "",
      summary: f.summary || "",
      source: f.source || "",
      url: f.url || undefined,
      detected_at: f.detected_at || new Date().toISOString(),
    }));

    storeSignals(company.company_id, signalFindings).catch((err) =>
      console.error("[StopRun] Signal store failed:", err),
    );

    await updateLastAgentRun(company.company_id);

    const definitions = await getSignalDefinitions(
      ctx.organizationId,
      company.company_id,
    );

    const reportData = generateReportFromFindings(
      company,
      signalFindings,
      definitions,
    );

    const aiSummary = await generateManualSummary(
      reportData,
      company.company_name,
    );
    if (aiSummary) {
      reportData.ai_summary = aiSummary;
      reportData.ai_summary_type = "summary";
    }

    const report = await storeReport(
      company.company_id,
      reportData,
      ctx.userId,
      "manual",
      ctx.organizationId,
    );

    let emailSent = false;
    try {
      const settings = await getUserSettings(ctx.userId);
      const emailTo = settings.email || ctx.userEmail;
      if (emailTo) {
        emailSent = await sendReportEmail(emailTo, company, reportData);
      }
    } catch (emailErr) {
      console.error(
        "[StopRun] Email failed for %s:",
        company.company_name,
        emailErr,
      );
    }

    return Response.json({
      report_id: report.report_id,
      report_data: reportData,
      total_signals: signalFindings.length,
      email_sent: emailSent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
});
