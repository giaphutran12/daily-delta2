import { NextRequest } from "next/server";
import { withOrg, OrgAuthContext } from "@/app/api/_lib/with-auth";
import { RunAgentsRequestSchema } from "@/lib/utils/validation";
import { createSSEStream } from "@/lib/utils/sse";
import { SignalFinding } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompanyById, updateLastAgentRun } from "@/services/company-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import { runIntelligenceAgents } from "@/services/orchestrator";
import { generateReportFromFindings, storeReport } from "@/services/report-service";
import { generateManualSummary } from "@/services/openrouter-service";
import { sendReportEmail } from "@/services/email-service";
import { getUserSettings } from "@/services/user-service";

export const maxDuration = 800;

function sanitizeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    console.warn("[Pipeline] Invalid detected_at value %j, using now()", value);
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

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
    detected_at: sanitizeTimestamp(f.detected_at),
  }));

  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    console.error("[Pipeline] Signal store failed:", error.message);
  }
}

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  const { response, sendEvent, close } = createSSEStream();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RunAgentsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 },
    );
  }

  const { company_id } = parsed.data;

  void (async () => {
    let findings: SignalFinding[] = [];

    try {
      console.log("[Pipeline] Starting run-agents for company_id=%s", company_id);

      const company = await getCompanyById(company_id);
      if (!company) {
        await sendEvent({
          type: "pipeline_error",
          data: { error: "Company not found" },
        });
        return;
      }

      if (company.organization_id !== ctx.organizationId) {
        await sendEvent({
          type: "pipeline_error",
          data: { error: "Company does not belong to this organization" },
        });
        return;
      }

      await sendEvent({
        type: "pipeline_started",
        data: {
          company_id: company.company_id,
          company_name: company.company_name,
          message: "Launching intelligence agents...",
        },
      });

      const definitions = await getSignalDefinitions(
        ctx.organizationId,
        company.company_id,
      );

      console.log(
        "[Pipeline] Running %d agents for %s",
        definitions.filter((d) => d.enabled).length,
        company.company_name,
      );

      findings = await runIntelligenceAgents(company, definitions, sendEvent);

      storeSignals(company.company_id, findings).catch((err) =>
        console.error("[Pipeline] Signal store failed:", err),
      );

      await updateLastAgentRun(company.company_id);

      const reportData = generateReportFromFindings(company, findings, definitions);

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

      await sendEvent({
        type: "report_generated",
        data: {
          report_id: report.report_id,
          report_data: reportData,
          total_signals: findings.length,
        },
      });

      try {
        const settings = await getUserSettings(ctx.userId);
        const emailTo = settings.email || ctx.userEmail;

        if (emailTo) {
          console.log(
            "[Pipeline] Sending email for %s to %s",
            company.company_name,
            emailTo,
          );
          const emailSent = await sendReportEmail(emailTo, company, reportData);
          await sendEvent({
            type: "email_sent",
            data: { success: emailSent, email: emailTo },
          });
        }
      } catch (emailErr) {
        console.error(
          "[Pipeline] Email failed for %s:",
          company.company_name,
          emailErr,
        );
        await sendEvent({ type: "email_sent", data: { success: false } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Pipeline] run-agents failed:", message);
      await sendEvent({
        type: "pipeline_error",
        data: { error: message },
      });
    } finally {
      await sendEvent({
        type: "pipeline_complete",
        data: {
          message: `All agents completed. ${findings.length} signals found.`,
          totalSignals: findings.length,
        },
      });
      await close();
      console.log("[Pipeline] run-agents stream closed company_id=%s", company_id);
    }
  })();

  return response;
});
