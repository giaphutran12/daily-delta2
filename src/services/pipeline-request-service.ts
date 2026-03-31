import { inngest } from "@/inngest/client";
import {
  PIPELINE_REQUESTED_EVENT,
  type PipelineRequestSource,
} from "@/inngest/events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Company } from "@/lib/types";
import {
  getCompanyById,
  getCompaniesByIds,
  getTrackedActiveCompanies,
  getTrackedCompanies,
  getTrackingOrgs,
} from "@/services/company-service";
import { previewDigestEmail, sendDigestEmail } from "@/services/email-service";
import { getOrganizationMembers } from "@/services/organization-service";
import { getDigestCompaniesForOutcomes } from "@/services/report-service";
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
  request_key: string | null;
  source: PipelineRequestSource;
  status: PipelineRequestStatus;
  requested_company_count: number;
  organization_id: string | null;
  requested_by_user_id: string | null;
  recipient_user_ids: string[] | null;
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
  created_at?: string;
  updated_at?: string;
}

export interface PreparedPipelineRequest {
  requestId: string;
  source: PipelineRequestSource;
  companyIds: string[];
  dispatches: Array<{ companyRunId: string; companyId: string }>;
}

export interface EnqueuePipelineRequestInput {
  source: PipelineRequestSource;
  requestKey?: string;
  companyIds?: string[];
  organizationId?: string;
  requestedByUserId?: string;
  recipientUserIds?: string[];
}

export interface CompanyRunCompletionEffects {
  successorDispatch: { companyRunId: string; companyId: string } | null;
  finalizeRequestIds: string[];
}

export interface PipelineDigestOutcome {
  companyId: string;
  reportId?: string | null;
  status: "completed" | "failed";
  signalCount: number;
  error?: string | null;
}

export interface PipelineDigestDelivery {
  requestId: string;
  orgId: string;
  email: string;
  outcomes: PipelineDigestOutcome[];
}

export interface PipelineDeliveryPlan {
  requestId: string;
  source: PipelineRequestSource;
  hadCompanyFailures: boolean;
  deliveries: PipelineDigestDelivery[];
}

export interface PipelineRequestCompanySummary {
  companyId: string;
  companyName: string;
  status: PipelineRequestCompanyStatus;
  signalCount: number;
  reportId: string | null;
  error: string | null;
}

export interface PipelineRequestDeliverySummary {
  orgId: string;
  email: string;
  sentAt: string | null;
}

export interface PipelineRequestSnapshot {
  requestId: string;
  requestKey: string | null;
  source: PipelineRequestSource;
  status: PipelineRequestStatus;
  requestedCompanyCount: number;
  organizationId: string | null;
  requestedByUserId: string | null;
  recipientUserIds: string[] | null;
  allCompaniesTerminal: boolean;
  previewAvailable: boolean;
  hadCompanyFailures: boolean;
  companies: PipelineRequestCompanySummary[];
  deliveries: PipelineRequestDeliverySummary[];
}

interface OrgRecipient {
  email: string;
  emailFrequency: EmailFrequency;
}

interface PipelineRequestDeliveryRow {
  delivery_id: string;
  request_id: string;
  recipient_email: string;
  sent_at: string | null;
}

export interface QueuedPipelineRequest {
  requestId: string | null;
  requestKey: string | null;
}

interface EnsuredPipelineRequestShell {
  request: PipelineRequestRow;
  created: boolean;
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
const STALE_COMPANY_RUN_MS = 20 * 60 * 1000;

function dedupeIds(ids?: string[]): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return [...new Set(ids.filter(Boolean))];
}

function normalizeManualRecipientUserIds(
  requestedByUserId?: string,
  recipientUserIds?: string[],
): string[] | undefined {
  const normalized = dedupeIds([
    ...(requestedByUserId ? [requestedByUserId] : []),
    ...(recipientUserIds ?? []),
  ]);

  return normalized && normalized.length > 0 ? normalized : undefined;
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

async function getScopedManualRecipientEmails(
  organizationId: string,
  requestedByUserId: string,
  recipientUserIds?: string[],
): Promise<string[]> {
  const memberRows = await getOrganizationMembers(organizationId);
  const memberByUserId = new Map(
    memberRows
      .filter((member): member is typeof member & { user_id: string } => !!member.user_id)
      .map((member) => [member.user_id, member]),
  );

  const targetUserIds = normalizeManualRecipientUserIds(
    requestedByUserId,
    recipientUserIds,
  ) ?? [requestedByUserId];

  const invalidUserIds = targetUserIds.filter((userId) => !memberByUserId.has(userId));
  if (invalidUserIds.length > 0) {
    throw new Error("Manual recipients must belong to the selected organization");
  }

  const recipients = await Promise.all(
    targetUserIds.map(async (userId) => {
      const member = memberByUserId.get(userId)!;
      const settings = await getUserSettings(userId);
      return settings.email || member.email || null;
    }),
  );

  return [...new Set(recipients.filter((email): email is string => !!email))];
}

function mapSourceToReportTrigger(
  source: PipelineRequestSource,
): "cron" | "manual" {
  return source === "cron" ? "cron" : "manual";
}

async function resolveCompaniesForRequest(
  source: PipelineRequestSource,
  companyIds?: string[],
  organizationId?: string,
): Promise<Company[]> {
  const normalizedIds = dedupeIds(companyIds);

  if (source === "manual" && organizationId) {
    const trackedCompanies = await getTrackedCompanies(organizationId);
    const trackedById = new Map(
      trackedCompanies.map((company) => [company.company_id, company]),
    );

    if (normalizedIds && normalizedIds.length > 0) {
      const scopedCompanies = normalizedIds
        .map((companyId) => trackedById.get(companyId))
        .filter((company): company is NonNullable<typeof company> => !!company);

      if (scopedCompanies.length !== normalizedIds.length) {
        throw new Error(
          "Some specified companies are not tracked by the selected organization",
        );
      }

      return scopedCompanies;
    }

    return trackedCompanies;
  }

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
      "request_id, source_event_id, request_key, source, status, requested_company_count, organization_id, requested_by_user_id, recipient_user_ids",
    )
    .eq("source_event_id", sourceEventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline request: ${error.message}`);
  }

  return (data as PipelineRequestRow | null) ?? null;
}

async function getRequestByRequestKey(
  requestKey: string,
): Promise<PipelineRequestRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_requests")
    .select(
      "request_id, source_event_id, request_key, source, status, requested_company_count, organization_id, requested_by_user_id, recipient_user_ids",
    )
    .eq("request_key", requestKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline request by request key: ${error.message}`);
  }

  return (data as PipelineRequestRow | null) ?? null;
}

async function createPipelineRequestRow(
  sourceEventId: string,
  requestKey: string | undefined,
  source: PipelineRequestSource,
  requestedCompanyCount: number,
  metadata?: Pick<
    PipelineRequestRow,
    "organization_id" | "requested_by_user_id" | "recipient_user_ids"
  >,
): Promise<PipelineRequestRow> {
  const supabase = createAdminClient();
  const status: PipelineRequestStatus =
    requestedCompanyCount > 0 ? "running" : "completed";

  const { data, error } = await supabase
    .from("pipeline_requests")
    .insert({
      source_event_id: sourceEventId,
      request_key: requestKey ?? null,
      source,
      status,
      requested_company_count: requestedCompanyCount,
      organization_id: metadata?.organization_id ?? null,
      requested_by_user_id: metadata?.requested_by_user_id ?? null,
      recipient_user_ids: metadata?.recipient_user_ids ?? null,
      updated_at: new Date().toISOString(),
    })
    .select(
      "request_id, source_event_id, request_key, source, status, requested_company_count, organization_id, requested_by_user_id, recipient_user_ids",
    )
    .single();

  if (error) {
    throw new Error(`Failed to create pipeline request: ${error.message}`);
  }

  return data as PipelineRequestRow;
}

async function syncPipelineRequestRow(
  requestId: string,
  sourceEventId: string,
  requestedCompanyCount: number,
  metadata?: Pick<
    PipelineRequestRow,
    "organization_id" | "requested_by_user_id" | "recipient_user_ids"
  >,
): Promise<void> {
  const supabase = createAdminClient();
  const status: PipelineRequestStatus =
    requestedCompanyCount > 0 ? "running" : "completed";

  const { error } = await supabase
    .from("pipeline_requests")
    .update({
      source_event_id: sourceEventId,
      status,
      requested_company_count: requestedCompanyCount,
      organization_id: metadata?.organization_id ?? null,
      requested_by_user_id: metadata?.requested_by_user_id ?? null,
      recipient_user_ids: metadata?.recipient_user_ids ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("request_id", requestId);

  if (error) {
    throw new Error(`Failed to sync pipeline request: ${error.message}`);
  }
}

async function ensurePipelineRequestShell(
  input: EnqueuePipelineRequestInput,
) : Promise<EnsuredPipelineRequestShell | null> {
  if (!input.requestKey) return null;

  const existing = await getRequestByRequestKey(input.requestKey);
  if (existing) {
    return {
      request: existing,
      created: false,
    };
  }

  const normalizedCompanyIds = dedupeIds(input.companyIds) ?? [];
  return {
    request: await createPipelineRequestRow(
      `queued:${input.requestKey}`,
      input.requestKey,
      input.source,
      normalizedCompanyIds.length,
      {
        organization_id: input.organizationId ?? null,
        requested_by_user_id: input.requestedByUserId ?? null,
        recipient_user_ids:
          normalizeManualRecipientUserIds(
            input.requestedByUserId,
            input.recipientUserIds,
          ) ?? null,
      },
    ),
    created: true,
  };
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
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error, created_at, updated_at",
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
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error, created_at, updated_at",
    )
    .single();

  if (error) {
    throw error;
  }

  return data as CompanyPipelineRunRow;
}

function isStaleCompanyRun(run: CompanyPipelineRunRow): boolean {
  const timestamp = run.updated_at ?? run.created_at;
  if (!timestamp) return false;
  return Date.now() - new Date(timestamp).getTime() > STALE_COMPANY_RUN_MS;
}

async function reclaimStaleCompanyRun(
  run: CompanyPipelineRunRow,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const staleSince = run.updated_at ?? run.created_at ?? now;

  const { error } = await supabase
    .from("company_pipeline_runs")
    .update({
      status: "failed",
      error: `Stale company run reclaimed after exceeding ${STALE_COMPANY_RUN_MS / 60000} minutes (last activity ${staleSince})`,
      completed_at: now,
      updated_at: now,
    })
    .eq("company_run_id", run.company_run_id)
    .in("status", ["queued", "running"]);

  if (error) {
    throw new Error(`Failed to reclaim stale company pipeline run: ${error.message}`);
  }
}

async function reattachRecoveredRequestCompanies(
  companyId: string,
  newCompanyRunId: string,
  reclaimedCompanyRunId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { error: attachedError } = await supabase
    .from("pipeline_request_companies")
    .update({
      company_run_id: newCompanyRunId,
      status: "queued",
      updated_at: now,
    })
    .eq("company_id", companyId)
    .eq("company_run_id", reclaimedCompanyRunId)
    .in("status", ["queued", "running"]);

  if (attachedError) {
    throw new Error(
      `Failed to rescue request companies from stale run: ${attachedError.message}`,
    );
  }

  const { error: waitingError } = await supabase
    .from("pipeline_request_companies")
    .update({
      company_run_id: newCompanyRunId,
      status: "queued",
      updated_at: now,
    })
    .eq("company_id", companyId)
    .eq("status", "waiting_for_rerun");

  if (waitingError) {
    throw new Error(
      `Failed to reattach waiting request companies after stale run recovery: ${waitingError.message}`,
    );
  }
}

async function attachRequestCompanyToRun(
  requestId: string,
  companyId: string,
  source: PipelineRequestSource,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  let activeRun = await getActiveCompanyRun(companyId);
  let reclaimedRunId: string | null = null;

  if (activeRun && isStaleCompanyRun(activeRun)) {
    reclaimedRunId = activeRun.company_run_id;
    await reclaimStaleCompanyRun(activeRun);
    activeRun = await getActiveCompanyRun(companyId);
  }

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
      if (activeRun && isStaleCompanyRun(activeRun)) {
        reclaimedRunId = activeRun.company_run_id;
        await reclaimStaleCompanyRun(activeRun);
        activeRun = await createCompanyRun(companyId, source);
      }
    }
  }

  if (!activeRun) {
    throw new Error(`Failed to attach company ${companyId} to an active run`);
  }

  if (reclaimedRunId) {
    await reattachRecoveredRequestCompanies(
      companyId,
      activeRun.company_run_id,
      reclaimedRunId,
    );
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
  input: EnqueuePipelineRequestInput,
): Promise<QueuedPipelineRequest> {
  const shell = await ensurePipelineRequestShell(input);

  if (shell && !shell.created) {
    return {
      requestId: shell.request.request_id,
      requestKey: shell.request.request_key ?? input.requestKey ?? null,
    };
  }

  await inngest.send({
    name: PIPELINE_REQUESTED_EVENT,
    data: {
      source: input.source,
      requestId: shell?.request.request_id,
      requestKey: input.requestKey,
      companyIds: dedupeIds(input.companyIds),
      organizationId: input.organizationId,
      requestedByUserId: input.requestedByUserId,
      recipientUserIds: normalizeManualRecipientUserIds(
        input.requestedByUserId,
        input.recipientUserIds,
      ),
    },
  });

  return {
    requestId: shell?.request.request_id ?? null,
    requestKey: shell?.request.request_key ?? input.requestKey ?? null,
  };
}

export async function preparePipelineRequest(
  sourceEventId: string,
  source: PipelineRequestSource,
  requestId?: string,
  requestKey?: string,
  requestedCompanyIds?: string[],
  metadata?: {
    organizationId?: string;
    requestedByUserId?: string;
    recipientUserIds?: string[];
  },
): Promise<PreparedPipelineRequest> {
  const normalizedRecipientUserIds = normalizeManualRecipientUserIds(
    metadata?.requestedByUserId,
    metadata?.recipientUserIds,
  );
  const companies = await resolveCompaniesForRequest(
    source,
    requestedCompanyIds,
    metadata?.organizationId,
  );
  const companyIds = [...new Set(companies.map((company) => company.company_id))];

  let request = requestId
    ? await getPipelineRequestById(requestId)
    : requestKey
      ? await getRequestByRequestKey(requestKey)
      : await getRequestBySourceEventId(sourceEventId);
  if (!request) {
    request = await createPipelineRequestRow(
      sourceEventId,
      requestKey,
      source,
      companyIds.length,
      {
        organization_id: metadata?.organizationId ?? null,
        requested_by_user_id: metadata?.requestedByUserId ?? null,
        recipient_user_ids: normalizedRecipientUserIds ?? null,
      },
    );
  }

  await syncPipelineRequestRow(request.request_id, sourceEventId, companyIds.length, {
    organization_id: metadata?.organizationId ?? null,
    requested_by_user_id: metadata?.requestedByUserId ?? null,
    recipient_user_ids: normalizedRecipientUserIds ?? null,
  });

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
      "company_run_id, company_id, requested_source, status, rerun_requested, requested_event_sent, report_id, signal_count, error, created_at, updated_at",
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
      "request_id, source_event_id, request_key, source, status, requested_company_count, organization_id, requested_by_user_id, recipient_user_ids",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline request: ${error.message}`);
  }

  return (data as PipelineRequestRow | null) ?? null;
}

async function getLastSentDigestAt(
  recipientEmail: string,
  source: PipelineRequestSource,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_request_deliveries")
    .select("sent_at, pipeline_requests!inner(source)")
    .eq("recipient_email", recipientEmail)
    .eq("pipeline_requests.source", source)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load last sent digest timestamp: ${error.message}`);
  }

  return (data as { sent_at: string | null } | null)?.sent_at ?? null;
}

async function ensurePipelineRequestDeliveries(
  requestId: string,
  recipientEmails: string[],
): Promise<void> {
  if (recipientEmails.length === 0) return;

  const supabase = createAdminClient();
  await Promise.all(
    recipientEmails.map(async (recipientEmail) => {
      const { error } = await supabase.from("pipeline_request_deliveries").insert({
        request_id: requestId,
        recipient_email: recipientEmail,
        updated_at: new Date().toISOString(),
      });

      if (error && !isUniqueViolation(error)) {
        throw new Error(`Failed to create pipeline delivery row: ${error.message}`);
      }
    }),
  );
}

async function getPipelineRequestDelivery(
  requestId: string,
  recipientEmail: string,
): Promise<PipelineRequestDeliveryRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("pipeline_request_deliveries")
    .select("delivery_id, request_id, recipient_email, sent_at")
    .eq("request_id", requestId)
    .eq("recipient_email", recipientEmail)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load pipeline delivery row: ${error.message}`);
  }

  return (data as PipelineRequestDeliveryRow | null) ?? null;
}

async function listPipelineRequestDeliveries(
  requestId: string,
  recipientEmails?: string[],
): Promise<PipelineRequestDeliveryRow[]> {
  if (recipientEmails && recipientEmails.length === 0) {
    return [];
  }

  const supabase = createAdminClient();
  let query = supabase
    .from("pipeline_request_deliveries")
    .select("delivery_id, request_id, recipient_email, sent_at")
    .eq("request_id", requestId);

  if (recipientEmails) {
    query = query.in("recipient_email", recipientEmails);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list pipeline deliveries: ${error.message}`);
  }

  return (data ?? []) as PipelineRequestDeliveryRow[];
}

async function markPipelineRequestDeliverySent(
  requestId: string,
  recipientEmail: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("pipeline_request_deliveries")
    .update({
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("request_id", requestId)
    .eq("recipient_email", recipientEmail)
    .is("sent_at", null);

  if (error) {
    throw new Error(`Failed to mark pipeline delivery as sent: ${error.message}`);
  }
}

function toPipelineDigestOutcome(
  row: PipelineRequestCompanyRow,
): PipelineDigestOutcome {
  if (row.status !== "completed" && row.status !== "failed") {
    throw new Error(
      `Cannot build a digest outcome from non-terminal request company status: ${row.status}`,
    );
  }

  return {
    companyId: row.company_id,
    reportId: row.report_id,
    status: row.status,
    signalCount: row.signal_count,
    error: row.error,
  };
}

async function getScopedRequestCompanyRows(
  request: PipelineRequestRow,
  requestCompanies: PipelineRequestCompanyRow[],
  organizationId: string,
): Promise<PipelineRequestCompanyRow[]> {
  if (request.organization_id) {
    if (request.organization_id !== organizationId) {
      return [];
    }

    return requestCompanies;
  }

  const trackedCompanies = await getTrackedCompanies(organizationId);
  const trackedCompanyIds = new Set(
    trackedCompanies.map((company) => company.company_id),
  );

  return requestCompanies.filter((row) => trackedCompanyIds.has(row.company_id));
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

  if (requestCompanies.length === 0) {
    return {
      requestId,
      source: request.source,
      hadCompanyFailures,
      deliveries: [],
    };
  }

  if (
    request.source === "manual" &&
    request.organization_id &&
    request.requested_by_user_id
  ) {
    const recipientEmails = await getScopedManualRecipientEmails(
      request.organization_id,
      request.requested_by_user_id,
      request.recipient_user_ids ?? undefined,
    );

    return {
      requestId,
      source: request.source,
      hadCompanyFailures,
      deliveries: recipientEmails.map((email) => ({
        requestId,
        orgId: request.organization_id!,
        email,
        outcomes: requestCompanies.map(toPipelineDigestOutcome),
      })),
    };
  }

  const orgIdsByCompanyId = new Map<string, string[]>();
  await Promise.all(
    requestCompanies.map(async (row) => {
      orgIdsByCompanyId.set(row.company_id, await getTrackingOrgs(row.company_id));
    }),
  );

  const outcomesByOrgId = new Map<string, PipelineDigestOutcome[]>();
  for (const row of requestCompanies) {
    const orgIds = orgIdsByCompanyId.get(row.company_id) ?? [];
    for (const orgId of orgIds) {
      if (!outcomesByOrgId.has(orgId)) {
        outcomesByOrgId.set(orgId, []);
      }
      outcomesByOrgId.get(orgId)!.push(toPipelineDigestOutcome(row));
    }
  }

  const deliveries: PipelineDigestDelivery[] = [];
  for (const [orgId, outcomes] of outcomesByOrgId) {
    const recipients = await getOrgRecipientEmails(orgId);
    if (recipients.length === 0) continue;

    let allowedRecipients = recipients;
    if (request.source === "cron") {
      const recipientChecks = await Promise.all(
        recipients.map(async (recipient) => ({
          recipient,
          lastSentAt: await getLastSentDigestAt(recipient.email, "cron"),
        })),
      );

      allowedRecipients = recipientChecks
        .filter(({ recipient, lastSentAt }) =>
          shouldRunToday(recipient.emailFrequency, lastSentAt),
        )
        .map(({ recipient }) => recipient);
    }

    for (const recipient of allowedRecipients) {
      deliveries.push({
        requestId,
        orgId,
        email: recipient.email,
        outcomes,
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

export async function getPipelineRequestSnapshot(
  requestId: string,
  organizationId: string,
): Promise<PipelineRequestSnapshot | null> {
  const request = await getPipelineRequestById(requestId);
  if (!request) {
    return null;
  }

  const requestCompanies = await listRequestCompanies(requestId);
  const scopedRequestCompanies = await getScopedRequestCompanyRows(
    request,
    requestCompanies,
    organizationId,
  );

  if (scopedRequestCompanies.length === 0) {
    return null;
  }

  const companies = await getCompaniesByIds(
    scopedRequestCompanies.map((row) => row.company_id),
  );
  const companyById = new Map(
    companies.map((company) => [company.company_id, company.company_name]),
  );

  const allCompaniesTerminal = scopedRequestCompanies.every(
    (row) => row.status === "completed" || row.status === "failed",
  );
  const hadCompanyFailures = scopedRequestCompanies.some(
    (row) => row.status === "failed" || !!row.error,
  );

  let deliveries: PipelineRequestDeliverySummary[] = [];
  if (allCompaniesTerminal) {
    const orgRecipientEmails =
      request.source === "manual" &&
      request.organization_id &&
      request.requested_by_user_id
        ? request.organization_id === organizationId
          ? await getScopedManualRecipientEmails(
              request.organization_id,
              request.requested_by_user_id,
              request.recipient_user_ids ?? undefined,
            )
          : []
        : (await getOrgRecipientEmails(organizationId)).map(
            (recipient) => recipient.email,
          );

    const deliveryRows = await listPipelineRequestDeliveries(
      requestId,
      [...new Set(orgRecipientEmails)],
    );

    if (deliveryRows.length > 0) {
      deliveries = deliveryRows.map((delivery) => ({
        orgId: organizationId,
        email: delivery.recipient_email,
        sentAt: delivery.sent_at,
      }));
    } else {
      const deliveryPlan = await buildPipelineDeliveryPlan(requestId);
      const scopedDeliveries = deliveryPlan.deliveries.filter(
        (delivery) => delivery.orgId === organizationId,
      );

      deliveries = scopedDeliveries.map((delivery) => ({
        orgId: delivery.orgId,
        email: delivery.email,
        sentAt: null,
      }));
    }
  }

  return {
    requestId: request.request_id,
    requestKey: request.request_key,
    source: request.source,
    status: request.status,
    requestedCompanyCount: request.requested_company_count,
    organizationId: request.organization_id,
    requestedByUserId: request.requested_by_user_id,
    recipientUserIds: request.recipient_user_ids,
    allCompaniesTerminal,
    previewAvailable: allCompaniesTerminal && scopedRequestCompanies.length > 0,
    hadCompanyFailures,
    companies: scopedRequestCompanies.map((row) => ({
      companyId: row.company_id,
      companyName: companyById.get(row.company_id) ?? "Unknown company",
      status: row.status,
      signalCount: row.signal_count,
      reportId: row.report_id,
      error: row.error,
    })),
    deliveries,
  };
}

export async function previewPipelineRequestDigest(
  requestId: string,
  organizationId: string,
): Promise<{ subject: string; html: string } | null> {
  const snapshot = await getPipelineRequestSnapshot(requestId, organizationId);
  if (!snapshot) {
    return null;
  }

  if (!snapshot.allCompaniesTerminal) {
    throw new Error(`Pipeline request ${requestId} is still running`);
  }

  const digestCompanies = await getDigestCompaniesForOutcomes(
    snapshot.companies.map((company) => ({
      companyId: company.companyId,
      reportId: company.reportId,
      status: company.status === "failed" ? "failed" : "completed",
      signalCount: company.signalCount,
      error: company.error,
    })),
  );

  if (digestCompanies.length === 0) {
    return null;
  }

  const preview = await previewDigestEmail(digestCompanies);
  return {
    subject: preview.subject,
    html: preview.html,
  };
}

export async function sendPipelineDigestDelivery(
  delivery: PipelineDigestDelivery,
): Promise<{ email: string; sent: boolean }> {
  if (delivery.outcomes.length === 0) {
    return { email: delivery.email, sent: false };
  }

  await ensurePipelineRequestDeliveries(delivery.requestId, [delivery.email]);
  const existingDelivery = await getPipelineRequestDelivery(
    delivery.requestId,
    delivery.email,
  );

  if (existingDelivery?.sent_at) {
    return { email: delivery.email, sent: true };
  }

  const digestCompanies = await getDigestCompaniesForOutcomes(delivery.outcomes);
  if (digestCompanies.length === 0) {
    return { email: delivery.email, sent: false };
  }

  const sent = await sendDigestEmail(delivery.email, digestCompanies, {
    idempotencyKey: `pipeline-request:${delivery.requestId}:${delivery.email}`,
  });
  if (sent) {
    await markPipelineRequestDeliverySent(delivery.requestId, delivery.email);
  }

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
