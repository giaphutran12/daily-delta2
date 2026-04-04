import { createClient } from "@/lib/supabase/client";
import type {
  Organization,
  OrganizationMember,
  Company,
  TrackedCompany,
  Signal,
  Report,
  ReportData,
  ReportSection,
  ReportSignal,
  SignalDefinition,
  Invitation,
  CompetitorLink,
} from "@/lib/types";

const API_BASE = "/api";

let currentOrgId: string | null = null;

export function setCurrentOrgId(id: string | null): void {
  currentOrgId = id;
}

export function getCurrentOrgId(): string | null {
  return currentOrgId;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.access_token}`,
  };
  if (currentOrgId) {
    headers["X-Organization-Id"] = currentOrgId;
  }
  return headers;
}

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const existingHeaders =
    opts.headers instanceof Headers
      ? Object.fromEntries(opts.headers.entries())
      : Array.isArray(opts.headers)
        ? Object.fromEntries(opts.headers)
        : (opts.headers as Record<string, string> | undefined) ?? {};
  const headers: Record<string, string> = { ...authHeaders, ...existingHeaders };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    const supabase = createClient();
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
      return fetch(url, { ...opts, headers });
    }
  }
  return res;
}

async function getApiErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; message?: string };
    return data.error ?? data.message ?? fallback;
  } catch {
    try {
      const text = await res.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
}

async function requireOk(
  res: Response,
  fallback: string,
): Promise<Response> {
  if (res.ok) return res;
  throw new Error(await getApiErrorMessage(res, fallback));
}

export type { Organization, OrganizationMember, Company, TrackedCompany, Signal, Report, ReportData, ReportSection, ReportSignal, SignalDefinition, CompetitorLink };

export type EmailFrequency = "daily" | "every_3_days" | "weekly" | "monthly";

export interface UserSettings {
  email: string | null;
  email_frequency: EmailFrequency;
}

export interface TriggerPipelineResponse {
  status: "queued";
  source: "manual";
  requestId: string | null;
  requestKey: string | null;
  requestedCompanyCount: number | null;
}

export interface PipelineRequestCompanySummary {
  companyId: string;
  companyName: string;
  status: "queued" | "running" | "waiting_for_rerun" | "completed" | "failed";
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
  source: "manual" | "cron" | "refresh";
  status: "queued" | "running" | "finalizing" | "completed" | "completed_with_errors";
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

export interface PipelineRequestPreview {
  subject: string;
  html: string;
}

function generateRequestKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export async function getOrganizations(): Promise<Organization[]> {
  const res = await authFetch(`${API_BASE}/organizations`);
  return res.json();
}

export async function createOrganization(name: string): Promise<Organization> {
  const res = await authFetch(`${API_BASE}/organizations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await requireOk(res, "Failed to create organization");
  const data = await res.json();
  return data.organization;
}

export async function getOrgMembers(orgId: string): Promise<OrganizationMember[]> {
  const res = await authFetch(`${API_BASE}/organizations/${orgId}/members`);
  return res.json();
}

export async function inviteMember(
  orgId: string,
  email: string,
  role?: string,
): Promise<{ success: boolean; error?: string; message?: string; pending?: boolean }> {
  const res = await authFetch(`${API_BASE}/organizations/${orgId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error ?? "Failed to invite" };
  return data;
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/organizations/${orgId}/members/${userId}`, {
    method: "DELETE",
  });
  await requireOk(res, "Failed to remove member");
}

export async function cancelInvitation(orgId: string, invitationId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/organizations/${orgId}/invitations/${invitationId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to cancel invitation");
  }
}

export async function acceptInvitation(token: string): Promise<{
  success: boolean;
  organization_id?: string;
  organization_name?: string;
  message?: string;
  error?: string;
}> {
  const res = await authFetch(`${API_BASE}/invitations/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

export async function getInvitationDetails(token: string): Promise<Invitation & { organization_name?: string; invited_by_email?: string }> {
  const res = await authFetch(`${API_BASE}/invitations/${token}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Failed to fetch invitation details");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Companies (platform catalog + tracking)
// ---------------------------------------------------------------------------

export async function searchCatalog(
  query?: string,
  filters?: { industry?: string },
  limit = 50,
  offset = 0,
): Promise<{ companies: Company[]; total: number }> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters?.industry) params.set("industry", filters.industry);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const res = await authFetch(`${API_BASE}/companies/catalog?${params}`);
  await requireOk(res, "Failed to search company catalog");
  return res.json();
}

export async function getCompanies(): Promise<{ companies: TrackedCompany[] }> {
  const res = await authFetch(`${API_BASE}/companies`);
  const data = await res.json();
  return { companies: data.companies ?? [] };
}

export async function untrackCompany(id: string): Promise<void> {
  await authFetch(`${API_BASE}/companies/${id}`, { method: "DELETE" });
}

export async function triggerManualPipelineRun(input: {
  companyIds: string[];
  recipientUserIds?: string[];
  requestKey?: string;
}): Promise<TriggerPipelineResponse> {
  const companyIds = input.companyIds.filter(Boolean);
  if (companyIds.length === 0) {
    throw new Error("Select at least one company to run");
  }

  const payload: {
    company_id?: string;
    company_ids?: string[];
    recipient_user_ids?: string[];
    request_key?: string;
  } = companyIds.length === 1
    ? { company_id: companyIds[0] }
    : { company_ids: companyIds };

  payload.request_key = input.requestKey ?? generateRequestKey();

  if (input.recipientUserIds?.length) {
    payload.recipient_user_ids = input.recipientUserIds;
  }

  const res = await authFetch(`${API_BASE}/trigger-pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await requireOk(res, "Failed to queue manual pipeline run");
  return res.json();
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function deleteReport(id: string): Promise<void> {
  await authFetch(`${API_BASE}/reports/${id}`, { method: "DELETE" });
}

export async function sendReportEmail(
  reportId: string,
): Promise<{ success: boolean; email?: string; error?: string }> {
  const res = await authFetch(`${API_BASE}/reports/${reportId}/send-email`, { method: "POST" });
  return res.json();
}

export async function previewReportEmail(reportId: string): Promise<string> {
  const res = await authFetch(`${API_BASE}/reports/${reportId}?preview=true`);
  return res.text();
}

export async function getPipelineRequest(
  requestId: string,
): Promise<PipelineRequestSnapshot> {
  const res = await authFetch(`${API_BASE}/pipeline-requests/${requestId}`);
  await requireOk(res, "Failed to fetch pipeline request");
  return res.json();
}

export async function previewPipelineRequestEmail(
  requestId: string,
): Promise<PipelineRequestPreview> {
  const res = await authFetch(`${API_BASE}/pipeline-requests/${requestId}?preview=true`);
  await requireOk(res, "Failed to preview pipeline request email");
  const encodedSubject = res.headers.get("x-digest-subject") ?? "";

  return {
    subject: encodedSubject ? decodeURIComponent(encodedSubject) : "",
    html: await res.text(),
  };
}

export async function getReports(companyId?: string): Promise<Report[]> {
  const url = companyId
    ? `${API_BASE}/reports?company_id=${companyId}`
    : `${API_BASE}/reports`;
  const res = await authFetch(url);
  const data = await res.json();
  return data.reports ?? [];
}

// ---------------------------------------------------------------------------
// Signals (individual findings from pipeline)
// ---------------------------------------------------------------------------

export async function getSignals(
  companyId: string,
  limit = 200,
  offset = 0,
): Promise<{ signals: Signal[]; total: number }> {
  const res = await authFetch(
    `${API_BASE}/signals?company_id=${companyId}&limit=${limit}&offset=${offset}`,
  );
  return res.json();
}

export async function getComparisonSignals(
  companyIds: string[],
  limit = 500,
): Promise<{ signals: Signal[]; total: number }> {
  const params = new URLSearchParams();
  params.set("company_ids", companyIds.join(","));
  params.set("limit", String(limit));
  const res = await authFetch(`${API_BASE}/signals?${params}`);
  await requireOk(res, "Failed to load comparison signals");
  return res.json();
}

export async function getCompetitors(
  companyId: string,
  query?: string,
): Promise<{ competitors: CompetitorLink[]; suggestions: Company[] }> {
  const params = new URLSearchParams();
  if (query?.trim()) {
    params.set("q", query.trim());
  }

  const res = await authFetch(
    `${API_BASE}/companies/${companyId}/competitors${params.size ? `?${params}` : ""}`,
  );
  await requireOk(res, "Failed to load competitors");
  return res.json();
}

export async function addCompetitor(
  companyId: string,
  payload:
    | { competitor_company_id: string }
    | { website_url: string; page_title?: string },
): Promise<{ success: boolean; competitor: Company; refreshQueued: boolean }> {
  const res = await authFetch(`${API_BASE}/companies/${companyId}/competitors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await requireOk(res, "Failed to add competitor");
  return res.json();
}

export async function removeCompetitor(
  companyId: string,
  competitorCompanyId: string,
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/companies/${companyId}/competitors?competitor_company_id=${encodeURIComponent(
      competitorCompanyId,
    )}`,
    {
      method: "DELETE",
    },
  );
  await requireOk(res, "Failed to remove competitor");
}

// ---------------------------------------------------------------------------
// Signal Definitions
// ---------------------------------------------------------------------------

export async function getSignalDefinitions(companyId?: string): Promise<SignalDefinition[]> {
  const url = companyId
    ? `${API_BASE}/signal-definitions?company_id=${companyId}`
    : `${API_BASE}/signal-definitions`;
  const res = await authFetch(url);
  const data = await res.json();
  return data.definitions ?? [];
}

export async function createSignalDefinition(data: {
  name: string;
  signal_type: string;
  display_name: string;
  target_url: string;
  search_instructions: string;
  company_id: string;
  sort_order?: number;
}): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  return result.definition;
}

export async function updateSignalDefinition(
  id: string,
  data: Partial<{
    name: string;
    signal_type: string;
    display_name: string;
    target_url: string;
    search_instructions: string;
    enabled: boolean;
    sort_order: number;
  }>,
): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  return result.definition;
}

export async function deleteSignalDefinition(id: string): Promise<void> {
  await authFetch(`${API_BASE}/signal-definitions/${id}`, { method: "DELETE" });
}

export async function toggleSignalDefinition(
  id: string,
  enabled: boolean,
): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions/${id}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  const result = await res.json();
  return result.definition;
}

// ---------------------------------------------------------------------------
// User Settings
// ---------------------------------------------------------------------------

export async function getUserSettings(): Promise<UserSettings> {
  const res = await authFetch(`${API_BASE}/user-settings`);
  await requireOk(res, "Failed to load user settings");
  return res.json();
}

export async function setEmail(email: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/user-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  await requireOk(res, "Failed to update delivery email");
}

export async function setEmailFrequency(
  frequency: EmailFrequency,
): Promise<void> {
  const res = await authFetch(`${API_BASE}/user-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frequency }),
  });
  await requireOk(res, "Failed to update email frequency");
}

// ---------------------------------------------------------------------------
// SSE Helpers (for add company flow)
// ---------------------------------------------------------------------------

const SSE_STALE_TIMEOUT = 90_000;

async function readSSE(
  response: Response,
  onEvent: (event: { type: string; data: unknown }) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  let staleTimer: ReturnType<typeof setTimeout> | undefined;

  const resetStaleTimer = () => {
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      reader.cancel().catch(() => {});
    }, SSE_STALE_TIMEOUT);
  };

  resetStaleTimer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resetStaleTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          onEvent(parsed);
        } catch (_parseError) {}
      }
    }
  } finally {
    clearTimeout(staleTimer);
  }
}

/**
 * Add a company to the platform and track it (SSE for discovery progress)
 */
export function addAndTrackCompanySSE(
  websiteUrl: string,
  onEvent: (event: { type: string; data: unknown }) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  getAuthHeaders().then((authHeaders) => {
    fetch(`${API_BASE}/companies`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ website_url: websiteUrl }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            onError("Session expired. Please sign in again.");
            return;
          }
          const err = await res.json().catch(() => ({ error: res.statusText }));
          onError(err.error ?? "Failed to add company");
          return;
        }
        await readSSE(res, onEvent);
        onDone();
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") onError(err.message);
      });
  });

  return controller;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export async function getChatMessages(companyId: string): Promise<{
  messages: Array<{ id: string; role: string; parts: unknown[] }>;
  sessionId: string;
}> {
  const res = await authFetch(`${API_BASE}/chat/${companyId}/messages`);
  await requireOk(res, "Failed to load chat history");
  return res.json();
}
