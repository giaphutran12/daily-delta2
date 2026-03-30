import { inngest } from "@/inngest/client";
import {
  PIPELINE_REQUESTED_EVENT,
  type PipelineRequestSource,
} from "@/inngest/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Company, DigestCompany } from "@/lib/types";
import {
  getCompanyById,
  getCompaniesByIds,
  getTrackedActiveCompanies,
  getTrackedCompanies,
  getTrackingOrgs,
} from "@/services/company-service";
import { sendDigestEmail } from "@/services/email-service";
import { getOrganizationMembers } from "@/services/organization-service";
import { getDigestCompaniesForReports } from "@/services/report-service";
import { processCompany } from "@/services/pipeline-service";
import {
  type EmailFrequency,
  getUserSettings,
} from "@/services/user-service";

type PipelineRequestStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "completed"
  | "completed_with_errors";

type PipelineRequestCompanyStatus =
  | "queued"
  | "running"
  | "waiting_for_rerun"
  | "completed"
  | "failed";

type CompanyPipelineRunStatus = "queued" | "running" | "completed" | "failed";

interface PipelineRequestRow {
  request_id: string;
  source_event_id: string;
  source: PipelineRequestSource;
  status: PipelineRequestStatus;
  requested_company_count: number;
}

interface PipelineRequestCompanyRow {
  request_company_id: string;
  request_id: string;
  company_id: string;
  company_run_id: string | null;
  status: PipelineRequestCompanyStatus;
  report_id: string | null;
  signal_count: number;
  error: string | null;
}

interface CompanyPipelineRunRow {
  company_run_id: string;
  company_id: string;
  requested_source: PipelineRequestSource;
  status: CompanyPipelineRunStatus;
  rerun_requested: boolean;
  requested_event_sent: boolean;
  report_id: string | null;
  signal_count: number;
  error: string | null;
}

export interface PreparedPipelineRequest {
  requestId: string;
  source: PipelineRequestSource;
  companyIds: string[];
  dispatches: Array<{ companyRunId: string; companyId: string }>;
}

export interface ProcessedCompanyRun {
  companyRunId: string;
  companyId: string;
  status: CompanyPipelineRunStatus;
  signalCount: number;
  reportId?: string;
  error?: string;
}

export interface CompanyRunCompletionEffects {
  successorDispatch: { companyRunId: string; companyId: string } | null;
  finalizeRequestIds: string[];
}

export interface PipelineDigestDelivery {
  requestId: string;
  orgId: string;
  email: string;
  reportIds: string[];
}

export interface PipelineDeliveryPlan {
  requestId: string;
  source: PipelineRequestSource;
  hadCompanyFailures: boolean;
  deliveries: PipelineDigestDelivery[];
}

interface OrgRecipient {
  email: string;
  emailFrequency: EmailFrequency;
}

const FREQUENCY_INTERVAL_DAYS: Record<EmailFrequency, number> = {
  daily: 1,
  every_3_days: 3,
  weekly: 7,
  monthly: 30,
};

const NON_TERMINAL_REQUEST_STATUSES: PipelineRequestStatus[] = ["queued", "running"];
const NON_TERMINAL_REQUEST_COMPANY_STATUSES: PipelineRequestCompanyStatus[] = [
  "queued",
  "running",
  "waiting_for_rerun",
];

function dedupeIds(ids?: string[]): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return [...new Set(ids.filter(Boolean))];
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "code" in error && error.code === "23505";
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

async function getOrgRecipientEmails(
  organizationId: string,
): Promise<OrgRecipient[]> {
  const members = await getOrganizationMembers(organizationId);
  const activeMembers = members.filter(
    (member): member is typeof member & { user_id: string } =>
      member.user_id !== null,
  );

  const recipients = await Promise.all(
    activeMembers.map(async (member) => {
      const settings = await getUserSettings(member.user_id);
      const email = settings.email || member.email || null;
      return email
        ? {
            email,
            emailFrequency: settings.email_frequency,
          }
        : null;
    }),
  );

  const seen = new Set<string>();
  return recipients.filter((recipient): recipient is OrgRecipient => {
    if (!recipient) return false;
    if (seen.has(recipient.email)) return false;
    seen.add(recipient.email);
    return true;
  });
}

function mapSourceToReportTrigger(
  source: PipelineRequestSource,
): "cron" | "manual" {
  return source === "cron" ? "cron" : "manual";
}

async function resolveCompaniesForRequest(
  source: PipelineRequestSource,
  companyIds?: string[],
): Promise<Company[]> {
  const normalizedIds = dedupeIds(companyIds);

  if (normalizedIds && normalizedIds.length > 0) {
    const companies = await getCompaniesByIds(normalizedIds);
    if (companies.length === 0) {
      throw new Error("None of the specified companies were found");
    }
    return companies;
  }

  if (source === "refresh") {
    return [];
  }

  return getTrackedActiveCompanies();
}

async function getRequestBySourceEventId(
  sourceEventId: string,
): Promise<PipelineRequestRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_requests")
    .select(
      "request_id, source_event_id, source, status, requested_company_count",
    )
    .eq("source_event_id", sourceEventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline request: ${error.message}`);
  }

  return (data as PipelineRequestRow | null) ?? null;
}

async function createPipelineRequestRow(
  sourceEventId: string,
  source: PipelineRequestSource,
  requestedCompanyCount: number,
): Promise<PipelineRequestRow> {
  const supabase = createAdminClient();
  const status: PipelineRequestStatus =
    requestedCompanyCount > 0 ? "running" : "completed";

  const { data, error } = await supabase
    .from("pipeline_requests")
    .insert({
      source_event_id: sourceEventId,
      source,
      status,
      requested_company_count: requestedCompanyCount,
      updated_at: new Date().toISOString(),
    })
    .select(
      "request_id, source_event_id, source, status, requested_company_count",
    )
    .single();

  if (error) {
    throw new Error(`Failed to create pipeline request: ${error.message}`);
  }

  return data as PipelineRequestRow;
}

async function listRequestCompanies(
  requestId: string,
): Promise<PipelineRequestCompanyRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_request_companies")
    .select(
      "request_company_id, request_id, company_id, company_run_id, status, report_id, signal_count, error",
    )
    .eq("request_id", requestId);

  if (error) {
    throw new Error(`Failed to load request companies: ${error.message}`);
  }

  return (data ?? []) as PipelineRequestCompanyRow[];
}

async function insertRequestCompanyRow(
  requestId: string,
  companyId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from("pipeline_request_companies").insert({
    request_id: requestId,
    company_id: companyId,
    updated_at: new Date().toISOString(),
  });

  if (error && !isUniqueViolation(error)) {
    throw new Error(`Failed to create request company row: ${error.message}`);
  }
}

async function getActiveCompanyRun(
  companyId: string,
): Promise<CompanyPipelineRunRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_pipeline_runs")
    .select(
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error",
    )
    .eq("company_id", companyId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active company run: ${error.message}`);
  }

  return (data as CompanyPipelineRunRow | null) ?? null;
}

async function createCompanyRun(
  companyId: string,
  source: PipelineRequestSource,
): Promise<CompanyPipelineRunRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_pipeline_runs")
    .insert({
      company_id: companyId,
      requested_source: source,
      status: "queued",
      updated_at: new Date().toISOString(),
    })
    .select(
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as CompanyPipelineRunRow;
}

async function attachRequestCompanyToRun(
  requestId: string,
  companyId: string,
  source: PipelineRequestSource,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  let activeRun = await getActiveCompanyRun(companyId);

  if (!activeRun) {
    try {
      activeRun = await createCompanyRun(companyId, source);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw new Error(
          `Failed to create company pipeline run: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      activeRun = await getActiveCompanyRun(companyId);
    }
  }

  if (!activeRun) {
    throw new Error(`Failed to attach company ${companyId} to an active run`);
  }

  if (activeRun.status === "running") {
    const { error: rerunError } = await supabase
      .from("company_pipeline_runs")
      .update({
        rerun_requested: true,
        updated_at: now,
      })
      .eq("company_run_id", activeRun.company_run_id);

    if (rerunError) {
      throw new Error(
        `Failed to request rerun for company ${companyId}: ${rerunError.message}`,
      );
    }

    const { error: requestError } = await supabase
      .from("pipeline_request_companies")
      .update({
        company_run_id: null,
        status: "waiting_for_rerun",
        updated_at: now,
      })
      .eq("request_id", requestId)
      .eq("company_id", companyId);

    if (requestError) {
      throw new Error(
        `Failed to attach request company to rerun queue: ${requestError.message}`,
      );
    }

    return;
  }

  const { error: attachError } = await supabase
    .from("pipeline_request_companies")
    .update({
      company_run_id: activeRun.company_run_id,
      status: "queued",
      updated_at: now,
    })
    .eq("request_id", requestId)
    .eq("company_id", companyId);

  if (attachError) {
    throw new Error(
      `Failed to attach request company to company run: ${attachError.message}`,
    );
  }
}

async function listUndispatchedQueuedRunsForRequest(
  requestId: string,
): Promise<Array<{ companyRunId: string; companyId: string }>> {
  const requestCompanies = await listRequestCompanies(requestId);
  const runIds = [...new Set(requestCompanies.map((row) => row.company_run_id).filter(Boolean))];

  if (runIds.length === 0) {
    return [];
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_pipeline_runs")
    .select("company_run_id, company_id, requested_event_sent, status")
    .in("company_run_id", runIds);

  if (error) {
    throw new Error(`Failed to load queued company runs: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    company_run_id: string;
    company_id: string;
    requested_event_sent: boolean;
    status: CompanyPipelineRunStatus;
  }>)
    .filter((row) => row.status === "queued" && !row.requested_event_sent)
    .map((row) => ({
      companyRunId: row.company_run_id,
      companyId: row.company_id,
    }));
}

export async function markCompanyRunsRequested(
  companyRunIds: string[],
): Promise<void> {
  if (companyRunIds.length === 0) return;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("company_pipeline_runs")
    .update({
      requested_event_sent: true,
      updated_at: new Date().toISOString(),
    })
    .in("company_run_id", companyRunIds);

  if (error) {
    throw new Error(`Failed to mark company runs as requested: ${error.message}`);
  }
}

export async function enqueuePipelineRequestedEvent(
  source: PipelineRequestSource,
  companyIds?: string[],
): Promise<void> {
  await inngest.send({
    name: PIPELINE_REQUESTED_EVENT,
    data: {
      source,
      companyIds: dedupeIds(companyIds),
    },
  });
}

export async function preparePipelineRequest(
  sourceEventId: string,
  source: PipelineRequestSource,
  requestedCompanyIds?: string[],
): Promise<PreparedPipelineRequest> {
  const companies = await resolveCompaniesForRequest(source, requestedCompanyIds);
  const companyIds = [...new Set(companies.map((company) => company.company_id))];

  let request = await getRequestBySourceEventId(sourceEventId);
  if (!request) {
    request = await createPipelineRequestRow(sourceEventId, source, companyIds.length);
  }

  if (companyIds.length === 0) {
    return {
      requestId: request.request_id,
      source,
      companyIds: [],
      dispatches: [],
    };
  }

  const existingRequestCompanies = await listRequestCompanies(request.request_id);
  const existingByCompanyId = new Set(
    existingRequestCompanies.map((row) => row.company_id),
  );

  await Promise.all(
    companyIds.map(async (companyId) => {
      if (!existingByCompanyId.has(companyId)) {
        await insertRequestCompanyRow(request!.request_id, companyId);
      }
    }),
  );

  await Promise.all(
    companyIds.map((companyId) =>
      attachRequestCompanyToRun(request!.request_id, companyId, source),
    ),
  );

  return {
    requestId: request.request_id,
    source,
    companyIds,
    dispatches: await listUndispatchedQueuedRunsForRequest(request.request_id),
  };
}

async function getCompanyRunById(
  companyRunId: string,
): Promise<CompanyPipelineRunRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("company_pipeline_runs")
    .select(
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error",
    )
    .eq("company_run_id", companyRunId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load company pipeline run: ${error.message}`);
  }

  return (data as CompanyPipelineRunRow | null) ?? null;
}

async function markCompanyRunRunning(companyRunId: string): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { error: runError } = await supabase
    .from("company_pipeline_runs")
    .update({
      status: "running",
      started_at: now,
      updated_at: now,
    })
    .eq("company_run_id", companyRunId)
    .eq("status", "queued");

  if (runError) {
    throw new Error(`Failed to mark company run running: ${runError.message}`);
  }

  const { error: requestError } = await supabase
    .from("pipeline_request_companies")
    .update({
      status: "running",
      updated_at: now,
    })
    .eq("company_run_id", companyRunId)
    .eq("status", "queued");

  if (requestError) {
    throw new Error(
      `Failed to mark request companies running: ${requestError.message}`,
    );
  }
}

export async function processQueuedCompanyRun(
  companyRunId: string,
): Promise<ProcessedCompanyRun> {
  const supabase = createAdminClient();
  const companyRun = await getCompanyRunById(companyRunId);

  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  if (companyRun.status === "completed" || companyRun.status === "failed") {
    return {
      companyRunId: companyRun.company_run_id,
      companyId: companyRun.company_id,
      status: companyRun.status,
      signalCount: companyRun.signal_count,
      reportId: companyRun.report_id ?? undefined,
      error: companyRun.error ?? undefined,
    };
  }

  if (companyRun.status === "queued") {
    await markCompanyRunRunning(companyRunId);
  }

  const company = await getCompanyById(companyRun.company_id);
  if (!company) {
    const message = `Company ${companyRun.company_id} not found`;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("company_pipeline_runs")
      .update({
        status: "failed",
        error: message,
        completed_at: now,
        updated_at: now,
      })
      .eq("company_run_id", companyRunId);

    if (error) {
      throw new Error(`Failed to store missing company failure: ${error.message}`);
    }

    return {
      companyRunId,
      companyId: companyRun.company_id,
      status: "failed",
      signalCount: 0,
      error: message,
    };
  }

  const result = await processCompany(
    company,
    mapSourceToReportTrigger(companyRun.requested_source),
  );

  const terminalStatus: CompanyPipelineRunStatus = result.error ? "failed" : "completed";
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("company_pipeline_runs")
    .update({
      status: terminalStatus,
      report_id: result.reportId ?? null,
      signal_count: result.signalCount,
      error: result.error ?? null,
      completed_at: now,
      updated_at: now,
    })
    .eq("company_run_id", companyRunId);

  if (error) {
    throw new Error(`Failed to store company run result: ${error.message}`);
  }

  return {
    companyRunId,
    companyId: result.companyId,
    status: terminalStatus,
    signalCount: result.signalCount,
    reportId: result.reportId,
    error: result.error,
  };
}

async function determineSuccessorSource(
  requestIds: string[],
): Promise<PipelineRequestSource> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_requests")
    .select("source")
    .in("request_id", requestIds);

  if (error) {
    throw new Error(`Failed to load successor request sources: ${error.message}`);
  }

  const sources = new Set(
    ((data ?? []) as Array<{ source: PipelineRequestSource }>).map(
      (row) => row.source,
    ),
  );

  if (sources.has("manual")) return "manual";
  if (sources.has("cron")) return "cron";
  return "refresh";
}

async function listRequestIdsReadyToFinalize(
  requestIds: string[],
): Promise<string[]> {
  if (requestIds.length === 0) return [];

  const supabase = createAdminClient();
  const ready = await Promise.all(
    [...new Set(requestIds)].map(async (requestId) => {
      const { count, error } = await supabase
        .from("pipeline_request_companies")
        .select("request_company_id", { count: "exact", head: true })
        .eq("request_id", requestId)
        .in("status", NON_TERMINAL_REQUEST_COMPANY_STATUSES);

      if (error) {
        throw new Error(`Failed to inspect request completion: ${error.message}`);
      }

      return (count ?? 0) === 0 ? requestId : null;
    }),
  );

  return ready.filter((requestId): requestId is string => requestId !== null);
}

export async function handleCompanyRunCompletion(
  companyRunId: string,
): Promise<CompanyRunCompletionEffects> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const companyRun = await getCompanyRunById(companyRunId);

  if (!companyRun) {
    throw new Error(`Company pipeline run ${companyRunId} not found`);
  }

  if (companyRun.status !== "completed" && companyRun.status !== "failed") {
    throw new Error(
      `Company pipeline run ${companyRunId} is not terminal yet (status: ${companyRun.status})`,
    );
  }

  const attachedRows = await listRequestCompaniesForRun(companyRunId);
  const terminalStatus: PipelineRequestCompanyStatus =
    companyRun.status === "completed" ? "completed" : "failed";

  if (attachedRows.length > 0) {
    const { error } = await supabase
      .from("pipeline_request_companies")
      .update({
        status: terminalStatus,
        report_id: companyRun.report_id,
        signal_count: companyRun.signal_count,
        error: companyRun.error,
        updated_at: now,
      })
      .eq("company_run_id", companyRunId)
      .in("status", ["queued", "running"]);

    if (error) {
      throw new Error(`Failed to finalize request company rows: ${error.message}`);
    }
  }

  let successorDispatch: { companyRunId: string; companyId: string } | null = null;

  if (companyRun.rerun_requested) {
    const waitingRows = await listWaitingRequestCompanies(companyRun.company_id);
    if (waitingRows.length > 0) {
      const nextSource = await determineSuccessorSource(
        waitingRows.map((row) => row.request_id),
      );
      const successorRun = await createCompanyRun(companyRun.company_id, nextSource);

      const { error } = await supabase
        .from("pipeline_request_companies")
        .update({
          company_run_id: successorRun.company_run_id,
          status: "queued",
          updated_at: now,
        })
        .eq("company_id", companyRun.company_id)
        .eq("status", "waiting_for_rerun");

      if (error) {
        throw new Error(`Failed to attach waiting rows to successor run: ${error.message}`);
      }

      successorDispatch = {
        companyRunId: successorRun.company_run_id,
        companyId: successorRun.company_id,
      };
    }
  }

  return {
    successorDispatch,
    finalizeRequestIds: await listRequestIdsReadyToFinalize(
      attachedRows.map((row) => row.request_id),
    ),
  };
}

async function listRequestCompaniesForRun(
  companyRunId: string,
): Promise<PipelineRequestCompanyRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_request_companies")
    .select(
      "request_company_id, request_id, company_id, company_run_id, status, report_id, signal_count, error",
    )
    .eq("company_run_id", companyRunId);

  if (error) {
    throw new Error(`Failed to load request companies for run: ${error.message}`);
  }

  return (data ?? []) as PipelineRequestCompanyRow[];
}

async function listWaitingRequestCompanies(
  companyId: string,
): Promise<PipelineRequestCompanyRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_request_companies")
    .select(
      "request_company_id, request_id, company_id, company_run_id, status, report_id, signal_count, error",
    )
    .eq("company_id", companyId)
    .eq("status", "waiting_for_rerun");

  if (error) {
    throw new Error(`Failed to load waiting request companies: ${error.message}`);
  }

  return (data ?? []) as PipelineRequestCompanyRow[];
}

export async function claimPipelineRequestForFinalization(
  requestId: string,
): Promise<{ claimed: boolean; source: PipelineRequestSource | null }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_requests")
    .update({
      status: "finalizing",
      updated_at: new Date().toISOString(),
    })
    .eq("request_id", requestId)
    .in("status", NON_TERMINAL_REQUEST_STATUSES)
    .select("source")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim pipeline request: ${error.message}`);
  }

  if (!data) {
    return { claimed: false, source: null };
  }

  return {
    claimed: true,
    source: (data as { source: PipelineRequestSource }).source,
  };
}

async function getPipelineRequestById(
  requestId: string,
): Promise<PipelineRequestRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_requests")
    .select(
      "request_id, source_event_id, source, status, requested_company_count",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline request: ${error.message}`);
  }

  return (data as PipelineRequestRow | null) ?? null;
}

export async function buildPipelineDeliveryPlan(
  requestId: string,
): Promise<PipelineDeliveryPlan> {
  const request = await getPipelineRequestById(requestId);
  if (!request) {
    throw new Error(`Pipeline request ${requestId} not found`);
  }

  const requestCompanies = await listRequestCompanies(requestId);
  const hadCompanyFailures = requestCompanies.some(
    (row) => row.status === "failed" || row.error,
  );

  if (request.source === "refresh") {
    return {
      requestId,
      source: request.source,
      hadCompanyFailures,
      deliveries: [],
    };
  }

  const successfulRows = requestCompanies.filter(
    (row) =>
      row.status === "completed" &&
      !!row.report_id &&
      row.signal_count > 0,
  );

  if (successfulRows.length === 0) {
    return {
      requestId,
      source: request.source,
      hadCompanyFailures,
      deliveries: [],
    };
  }

  const orgIdsByCompanyId = new Map<string, string[]>();
  await Promise.all(
    successfulRows.map(async (row) => {
      orgIdsByCompanyId.set(row.company_id, await getTrackingOrgs(row.company_id));
    }),
  );

  const reportIdsByOrgId = new Map<string, string[]>();
  for (const row of successfulRows) {
    const reportId = row.report_id!;
    const orgIds = orgIdsByCompanyId.get(row.company_id) ?? [];
    for (const orgId of orgIds) {
      if (!reportIdsByOrgId.has(orgId)) {
        reportIdsByOrgId.set(orgId, []);
      }
      reportIdsByOrgId.get(orgId)!.push(reportId);
    }
  }

  const deliveries: PipelineDigestDelivery[] = [];
  for (const [orgId, reportIds] of reportIdsByOrgId) {
    const recipients = await getOrgRecipientEmails(orgId);
    if (recipients.length === 0) continue;

    let allowedRecipients = recipients;
    if (request.source === "cron") {
      const trackedCompanies = await getTrackedCompanies(orgId);
      const orgLastRun = trackedCompanies.reduce<string | null>(
        (earliest, trackedCompany) => {
          if (!trackedCompany.last_agent_run) return earliest;
          if (!earliest) return trackedCompany.last_agent_run;
          return trackedCompany.last_agent_run < earliest
            ? trackedCompany.last_agent_run
            : earliest;
        },
        null,
      );

      allowedRecipients = recipients.filter((recipient) =>
        shouldRunToday(recipient.emailFrequency, orgLastRun),
      );
    }

    for (const recipient of allowedRecipients) {
      deliveries.push({
        requestId,
        orgId,
        email: recipient.email,
        reportIds: [...new Set(reportIds)],
      });
    }
  }

  return {
    requestId,
    source: request.source,
    hadCompanyFailures,
    deliveries,
  };
}

export async function sendPipelineDigestDelivery(
  delivery: PipelineDigestDelivery,
): Promise<{ email: string; sent: boolean }> {
  const digestCompanies = await getDigestCompaniesForReports(delivery.reportIds);
  if (digestCompanies.length === 0) {
    return { email: delivery.email, sent: false };
  }

  const sent = await sendDigestEmail(delivery.email, digestCompanies);
  return { email: delivery.email, sent };
}

export async function markPipelineRequestFinalized(
  requestId: string,
  options: {
    hadCompanyFailures: boolean;
    hadEmailFailures: boolean;
  },
): Promise<void> {
  const supabase = createAdminClient();
  const status: PipelineRequestStatus =
    options.hadCompanyFailures || options.hadEmailFailures
      ? "completed_with_errors"
      : "completed";

  const { error } = await supabase
    .from("pipeline_requests")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("request_id", requestId);

  if (error) {
    throw new Error(`Failed to finalize pipeline request: ${error.message}`);
  }
}

export async function buildDigestCompaniesForReports(
  reportIds: string[],
): Promise<DigestCompany[]> {
  return getDigestCompaniesForReports(reportIds);
}
