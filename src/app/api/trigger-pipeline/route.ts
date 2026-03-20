import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignalFinding } from "@/lib/types";
import {
  getCompanies,
  updateLastAgentRun,
} from "@/services/company-service";
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
import { getUserSettings } from "@/services/user-service";

export const maxDuration = 800;

// --- Helper functions (mirrored from process-org.ts) ---

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

interface OrgRecipient {
  userId: string;
  email: string | null;
  emailFrequency: EmailFrequency;
}

async function getOrgRecipients(
  organizationId: string,
): Promise<OrgRecipient[]> {
  const members = await getOrganizationMembers(organizationId);
  const activeMembers = members.filter(
    (m): m is typeof m & { user_id: string } => m.user_id !== null,
  );

  return Promise.all(
    activeMembers.map(async (member) => {
      const settings = await getUserSettings(member.user_id);
      return {
        userId: member.user_id,
        email: settings.email || member.email || null,
        emailFrequency: settings.email_frequency,
      };
    }),
  );
}

// --- Discover all active organization IDs ---

async function getActiveOrganizationIds(): Promise<string[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("companies")
    .select("organization_id")
    .eq("tracking_status", "active")
    .not("organization_id", "is", null);

  if (error) {
    throw new Error(
      `[PIPELINE] Failed to load active orgs: ${error.message}`,
    );
  }

  return Array.from(
    new Set(
      (data ?? []).map((row) => row.organization_id).filter(Boolean),
    ),
  );
}

// --- Process a single organization ---

async function processOrganization(organizationId: string) {
  const companies = await getCompanies(organizationId);

  if (companies.length === 0) {
    console.log("[PIPELINE] Org %s has no active companies", organizationId);
    return { organizationId, status: "no-op" as const, companies: [] };
  }

  const recipients = await getOrgRecipients(organizationId);
  const companyResults = [];

  for (const company of companies) {
    const tag = `[PIPELINE] [${company.company_name}]`;
    const startTime = Date.now();

    try {
      console.log("%s Starting (%s)", tag, company.company_id);

      // 1. Load signal definitions
      const definitions = await getSignalDefinitions(
        organizationId,
        company.company_id,
      );
      const enabledDefinitions = definitions.filter((d) => d.enabled);
      console.log(
        "%s Loaded %d definitions (%d enabled)",
        tag,
        definitions.length,
        enabledDefinitions.length,
      );

      // 2. Run intelligence agents
      console.log("%s Running intelligence agents...", tag);
      const findings = await runIntelligenceAgentsSilent(company, definitions);
      console.log("%s Agents returned %d findings", tag, findings.length);

      // 3. Snapshot & delta per definition
      const previousSignals: SignalFinding[] = [];

      for (const definition of enabledDefinitions) {
        const signalsForDefinition = findings.filter(
          (f) => f.signal_definition_id === definition.id,
        );

        const previousSnapshot = await getPreviousSnapshot(
          company.company_id,
          definition.id,
        );

        if (previousSnapshot) {
          const prev = extractSignalsFromSnapshot(
            previousSnapshot.raw_response,
          );
          previousSignals.push(...prev);
          console.log(
            "%s  Definition %s: %d today, %d previous",
            tag,
            definition.name,
            signalsForDefinition.length,
            prev.length,
          );
        } else {
          console.log(
            "%s  Definition %s: %d today, no previous snapshot",
            tag,
            definition.name,
            signalsForDefinition.length,
          );
        }

        await storeSnapshot(company.company_id, definition.id, {
          signals: signalsForDefinition,
        });
      }

      // 4. Compute delta
      console.log(
        "%s Computing delta (%d today vs %d previous)...",
        tag,
        findings.length,
        previousSignals.length,
      );
      const delta = await computeDelta(
        findings,
        previousSignals,
        company.company_name,
      );
      const deltaFindings = mergeDeltaSignals(
        delta.newSignals,
        delta.changedSignals,
      );
      console.log(
        "%s Delta: %d new, %d changed, %d merged unique",
        tag,
        delta.newSignals.length,
        delta.changedSignals.length,
        deltaFindings.length,
      );

      // 5. Store signals
      await storeSignals(company.company_id, deltaFindings);
      await updateLastAgentRun(company.company_id);
      console.log("%s Stored %d signals", tag, deltaFindings.length);

      // 6. Generate & store report
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
      console.log(
        "%s Report stored (%d sections, ai_summary=%s)",
        tag,
        reportData.sections.length,
        delta.llmSummary ? "yes" : "no",
      );

      // 7. Send emails (always send — no frequency gating on manual trigger)
      let emailsSent = 0;
      let emailsSkipped = 0;

      for (const recipient of recipients) {
        if (!recipient.email) {
          console.log("%s Skipping recipient %s (no email)", tag, recipient.userId);
          emailsSkipped += 1;
          continue;
        }

        const sent = await sendReportEmail(
          recipient.email,
          company,
          reportData,
        );
        if (sent) {
          console.log("%s Email sent to %s", tag, recipient.email);
          emailsSent += 1;
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        "%s Done in %ss — %d findings, %d delta, %d emails sent, %d skipped",
        tag,
        elapsed,
        findings.length,
        deltaFindings.length,
        emailsSent,
        emailsSkipped,
      );

      companyResults.push({
        companyId: company.company_id,
        companyName: company.company_name,
        totalFindings: findings.length,
        deltaFindings: deltaFindings.length,
        emailsSent,
        emailsSkipped,
      });
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(
        "%s FAILED after %ss: %s",
        tag,
        elapsed,
        error instanceof Error ? error.message : String(error),
      );
      companyResults.push({
        companyId: company.company_id,
        companyName: company.company_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    organizationId,
    status: "completed" as const,
    companies: companyResults,
  };
}

// --- Route handler ---

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { organization_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — process all orgs
  }

  const pipelineStart = Date.now();

  try {
    const orgIds = body.organization_id
      ? [body.organization_id]
      : await getActiveOrganizationIds();

    if (orgIds.length === 0) {
      console.log("[PIPELINE] No organizations with active companies");
      return NextResponse.json({
        status: "no-op",
        organizations: 0,
        results: [],
      });
    }

    console.log(
      "[PIPELINE] Processing %d organization(s): %s",
      orgIds.length,
      orgIds.join(", "),
    );

    const results = [];
    for (const orgId of orgIds) {
      const result = await processOrganization(orgId);
      results.push(result);
    }

    const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    console.log("[PIPELINE] Pipeline finished in %ss", totalElapsed);

    return NextResponse.json({
      status: "completed",
      organizations: orgIds.length,
      elapsed_seconds: parseFloat(totalElapsed),
      results,
    });
  } catch (error) {
    const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    console.error("[PIPELINE] Fatal error after %ss:", totalElapsed, error);
    return NextResponse.json(
      {
        error: "Pipeline failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
