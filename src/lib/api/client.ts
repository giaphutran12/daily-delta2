import { createClient } from "@/lib/supabase/client";
import type {
  Organization,
  OrganizationMember,
  Company,
  Report,
  ReportData,
  ReportSection,
  ReportSignal,
  SignalDefinition,
  Invitation,
} from "@/lib/types";

const API_BASE = "/api";

let currentOrgId: string | null = null;

export function setCurrentOrgId(id: string | null): void {
  currentOrgId = id;
}

export function getCurrentOrgId(): string | null {
  return currentOrgId;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
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

export type { Organization, OrganizationMember, Company, Report, ReportData, ReportSection, ReportSignal, SignalDefinition };

export type EmailFrequency = "daily" | "every_3_days" | "weekly" | "monthly" | "only_on_run";

export interface UserSettings {
  email: string | null;
  email_frequency: EmailFrequency;
}

export interface AgentState {
  agentId: string;
  agentType: string;
  agentName: string;
  status: "connecting" | "browsing" | "analyzing" | "complete" | "error";
  message?: string;
  streamingUrl?: string;
  findings?: { signals: Array<{ signal_type: string; title: string; summary: string; source: string }> };
  error?: string;
}

export interface ActiveRun {
  companyId: string;
  companyName: string;
  agents: AgentState[];
  isComplete: boolean;
  liveReport: ReportData | null;
  emailSent?: boolean;
  startedAt: number;
  queued?: boolean;
}

export interface StopRunResult {
  report_id: string;
  report_data: ReportData;
  total_signals: number;
  email_sent: boolean;
}

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
  await authFetch(`${API_BASE}/organizations/${orgId}/members/${userId}`, { method: "DELETE" });
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

export async function checkCompanyDomain(
  domain: string,
): Promise<{ exists: boolean; company?: Company }> {
  const res = await authFetch(`${API_BASE}/companies/check?domain=${encodeURIComponent(domain)}`);
  return res.json();
}

export async function getCompanies(): Promise<{ companies: Company[]; company_limit: number }> {
  const res = await authFetch(`${API_BASE}/companies`);
  const data = await res.json();
  return { companies: data.companies ?? [], company_limit: data.company_limit ?? 5 };
}

export async function deleteCompany(id: string): Promise<void> {
  await authFetch(`${API_BASE}/companies/${id}`, { method: "DELETE" });
}

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

export async function getReports(companyId?: string): Promise<Report[]> {
  const url = companyId
    ? `${API_BASE}/reports?company_id=${companyId}`
    : `${API_BASE}/reports`;
  const res = await authFetch(url);
  const data = await res.json();
  return data.reports ?? [];
}

export async function getUserSettings(): Promise<UserSettings> {
  const res = await authFetch(`${API_BASE}/user-settings`);
  return res.json();
}

export async function setEmail(email: string, frequency?: EmailFrequency): Promise<void> {
  await authFetch(`${API_BASE}/user-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_frequency: frequency }),
  });
}

export async function setEmailFrequency(frequency: EmailFrequency): Promise<void> {
  await authFetch(`${API_BASE}/user-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email_frequency: frequency }),
  });
}

export async function stopRun(
  companyId: string,
  findings: Array<{
    signal_type: string;
    title: string;
    summary: string;
    source: string;
    url?: string;
  }>,
): Promise<StopRunResult> {
  const res = await authFetch(`${API_BASE}/stop-run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId, findings }),
  });
  return res.json();
}

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
  scope?: "global" | "company";
  company_id?: string | null;
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
    scope: "global" | "company";
    company_id: string | null;
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

export function storeCompanySSE(
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
          onError(err.error ?? "Failed to store company");
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

export function runAgentsSSE(
  companyId: string,
  onEvent: (event: { type: string; data: unknown }) => void,
  onDone: () => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  getAuthHeaders().then((authHeaders) => {
    fetch(`${API_BASE}/run-agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ company_id: companyId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) {
            onError("Session expired. Please sign in again.");
            return;
          }
          const err = await res.json().catch(() => ({ error: res.statusText }));
          onError(err.error ?? "Failed to run agents");
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
