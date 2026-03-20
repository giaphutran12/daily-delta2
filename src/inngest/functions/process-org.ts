import { inngest } from "../client";
import { orgProcess } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignalFinding } from "@/lib/types";
import { getCompanies, updateLastAgentRun } from "@/services/company-service";
import {
  computeDelta,
  getPreviousSnapshot,
  storeSnapshot,
} from "@/services/delta-service";
import { sendReportEmail } from "@/services/email-service";
import { runIntelligenceAgentsSilent } from "@/services/orchestrator";
import {
  generateReportFromFindings,
  storeReport,
} from "@/services/report-service";
import { getSignalDefinitions } from "@/services/signal-definition-service";
import { getOrganizationMembers } from "@/services/organization-service";
import { EmailFrequency, getUserSettings } from "@/services/user-service";

const FREQUENCY_INTERVAL_DAYS: Record<EmailFrequency, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
  monthly: 30,
};

interface OrgRecipient {
  userId: string;
  email: string | null;
  emailFrequency: EmailFrequency;
}

function shouldRunToday(
  frequency: EmailFrequency,
  lastRun: string | null,
): boolean {
  const intervalDays = FREQUENCY_INTERVAL_DAYS[frequency] || 1;
  if (!lastRun) return true;
  const daysSince =
    (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= intervalDays;
}

function buildSignalHash(signal: SignalFinding): string {
  return [
    signal.signal_type,
    signal.title.trim().toLowerCase(),
    signal.source.trim().toLowerCase(),
    (signal.url || "").trim().toLowerCase(),
  ].join("|");
}

function mergeDeltaSignals(
  newSignals: SignalFinding[],
  changedSignals: SignalFinding[],
): SignalFinding[] {
  const merged = [...newSignals, ...changedSignals];
  const seen = new Set<string>();
  return merged.filter((signal) => {
    const hash = buildSignalHash(signal);
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

function extractSignalsFromSnapshot(raw: unknown): SignalFinding[] {
  if (!raw || typeof raw !== "object") return [];
  const signals = (raw as { signals?: unknown }).signals;
  if (!Array.isArray(signals)) return [];

  return signals
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const finding = row as Record<string, unknown>;
      if (
        typeof finding.signal_type !== "string" ||
        typeof finding.title !== "string" ||
        typeof finding.summary !== "string" ||
        typeof finding.source !== "string"
      ) {
        return null;
      }

      return {
        signal_type: finding.signal_type,
        title: finding.title,
        summary: finding.summary,
        source: finding.source,
        ...(typeof finding.url === "string" ? { url: finding.url } : {}),
        ...(typeof finding.detected_at === "string"
          ? { detected_at: finding.detected_at }
          : {}),
        ...(typeof finding.signal_definition_id === "string"
          ? { signal_definition_id: finding.signal_definition_id }
          : {}),
      };
    })
    .filter((finding): finding is SignalFinding => !!finding);
}

function sanitizeTimestamp(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    console.warn("[PIPELINE] Invalid detected_at value %j, using now()", value);
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
  const rows = findings.map((finding) => ({
    company_id: companyId,
    signal_definition_id: finding.signal_definition_id || null,
    signal_type: finding.signal_type,
    source: finding.source,
    title: finding.title,
    content: finding.summary,
    url: finding.url || null,
    detected_at: sanitizeTimestamp(finding.detected_at),
  }));

  const { error } = await supabase.from("signals").insert(rows);
  if (error) {
    throw new Error(`[PIPELINE] Signal store failed: ${error.message}`);
  }
}

async function getOrgRecipients(organizationId: string): Promise<OrgRecipient[]> {
  const members = await getOrganizationMembers(organizationId);

  const activeMembers = members.filter((m): m is typeof m & { user_id: string } => m.user_id !== null);

  const settingsRows = await Promise.all(
    activeMembers.map(async (member) => {
      const settings = await getUserSettings(member.user_id);
      return {
        userId: member.user_id,
        email: settings.email || member.email || null,
        emailFrequency: settings.email_frequency,
      };
    }),
  );

  return settingsRows;
}

export const processOrg = inngest.createFunction(
  {
    id: "process-org",
    triggers: [{ event: orgProcess }],
    concurrency: [{ limit: 3, key: "event.data.organizationId" }],
  },
  async ({ event, step }) => {
    const { organizationId } = event.data;

    const companies = await step.run("load-org-companies", async () => {
      return getCompanies(organizationId);
    });

    if (companies.length === 0) {
      console.log("[PIPELINE] Org %s has no active companies", organizationId);
      return { status: "no-op", organizationId, companies: 0 };
    }

    const recipients = await step.run("load-org-recipients", async () => {
      return getOrgRecipients(organizationId);
    });

    const companyResults = [];

    for (const company of companies) {
      const result = await step.run(`company-${company.company_id}`, async () => {
        console.log(
          "[PIPELINE] Processing company %s (%s)",
          company.company_name,
          company.company_id,
        );

        const definitions = await getSignalDefinitions(
          organizationId,
          company.company_id,
        );
        const findings = await runIntelligenceAgentsSilent(company, definitions);

        const previousSignals: SignalFinding[] = [];
        const enabledDefinitions = definitions.filter((definition) => definition.enabled);

        for (const definition of enabledDefinitions) {
          const signalsForDefinition = findings.filter(
            (finding) => finding.signal_definition_id === definition.id,
          );

          const previousSnapshot = await getPreviousSnapshot(
            company.company_id,
            definition.id,
          );

          if (previousSnapshot) {
            previousSignals.push(
              ...extractSignalsFromSnapshot(previousSnapshot.raw_response),
            );
          }

          await storeSnapshot(company.company_id, definition.id, {
            signals: signalsForDefinition,
          });
        }

        const delta = await computeDelta(
          findings,
          previousSignals,
          company.company_name,
        );
        const deltaFindings = mergeDeltaSignals(
          delta.newSignals,
          delta.changedSignals,
        );

        await storeSignals(company.company_id, deltaFindings);
        await updateLastAgentRun(company.company_id);

        const reportData = generateReportFromFindings(
          company,
          deltaFindings,
          definitions,
        );
        if (delta.llmSummary) {
          reportData.ai_summary = delta.llmSummary;
          reportData.ai_summary_type = "business_intelligence";
        }

        await storeReport(
          company.company_id,
          reportData,
          company.user_id,
          "cron",
          organizationId,
        );

        let emailSent = 0;
        let emailSkipped = 0;

        for (const recipient of recipients) {
          if (!recipient.email) {
            emailSkipped += 1;
            continue;
          }

          if (!shouldRunToday(recipient.emailFrequency, company.last_agent_run)) {
            emailSkipped += 1;
            continue;
          }

          const sent = await sendReportEmail(recipient.email, company, reportData);
          if (sent) {
            emailSent += 1;
          }
        }

        return {
          companyId: company.company_id,
          companyName: company.company_name,
          totalFindings: findings.length,
          deltaFindings: deltaFindings.length,
          emailsSent: emailSent,
          emailsSkipped: emailSkipped,
        };
      });

      companyResults.push(result);
    }

    return {
      status: "completed",
      organizationId,
      companies: companyResults,
    };
  }
);
