import { supabase } from '../lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE as string;

// ---------- Organization Context ----------

let currentOrgId: string | null = null;

export function setCurrentOrgId(orgId: string | null) {
  currentOrgId = orgId;
}

export function getCurrentOrgId(): string | null {
  return currentOrgId;
}

// ---------- Auth Helper ----------

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  const headers: Record<string, string> = { Authorization: `Bearer ${session.access_token}` };
  if (currentOrgId) {
    headers['X-Organization-Id'] = currentOrgId;
  }
  return headers;
}

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const existingHeaders = opts.headers instanceof Headers
    ? Object.fromEntries(opts.headers.entries())
    : Array.isArray(opts.headers)
      ? Object.fromEntries(opts.headers)
      : (opts.headers as Record<string, string> | undefined) || {};
  const headers: Record<string, string> = { ...authHeaders, ...existingHeaders };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    const { data } = await supabase.auth.refreshSession();
    if (data.session) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
      if (currentOrgId) headers['X-Organization-Id'] = currentOrgId;
      return fetch(url, { ...opts, headers });
    }
  }
  return res;
}

// ---------- Types ----------

export interface Organization {
  organization_id: string;
  name: string;
  slug: string;
  created_at: string;
  role?: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string | null;
  role: 'owner' | 'admin' | 'member';
  joined_at: string | null;
  email?: string;
  status?: 'active' | 'pending';
  expires_at?: string;
  invited_by_email?: string;
}

export interface Company {
  company_id: string;
  company_name: string;
  website_url: string;
  domain: string;
  description: string | null;
  industry: string | null;
  careers_url: string | null;
  blog_url: string | null;
  pricing_url: string | null;
  created_at: string;
  last_agent_run: string | null;
  tracking_status: string;
}

export interface SignalDefinition {
  id: string;
  organization_id: string;
  company_id: string | null;
  name: string;
  signal_type: string;
  display_name: string;
  target_url: string;
  search_instructions: string;
  scope: 'global' | 'company';
  enabled: boolean;
  sort_order: number;
}

export interface ReportSignal {
  title: string;
  summary: string;
  source: string;
  url?: string;
  detected_at: string;
}

export interface ReportSection {
  signal_type: string;
  display_name: string;
  items: ReportSignal[];
}

export interface ReportData {
  company_overview: string;
  sections: ReportSection[];
  ai_summary?: string;
  ai_summary_type?: 'summary' | 'business_intelligence';
  product_launches?: ReportSignal[];
  financings?: ReportSignal[];
  leadership_changes?: ReportSignal[];
  revenue_milestones?: ReportSignal[];
  customer_wins?: ReportSignal[];
  pricing_updates?: ReportSignal[];
  hiring_trends?: ReportSignal[];
  general_news?: ReportSignal[];
  founder_contacts?: ReportSignal[];
  leading_indicators?: ReportSignal[];
  competitive_landscape?: ReportSignal[];
  fundraising_signals?: ReportSignal[];
}

const LEGACY_SECTION_MAP: Array<{ key: string; signal_type: string; display_name: string }> = [
  { key: 'product_launches', signal_type: 'product_launch', display_name: 'Product Launches' },
  { key: 'financings', signal_type: 'financing', display_name: 'Financings' },
  { key: 'leadership_changes', signal_type: 'leadership_change', display_name: 'Leadership Changes' },
  { key: 'revenue_milestones', signal_type: 'revenue_milestone', display_name: 'Revenue Milestones' },
  { key: 'customer_wins', signal_type: 'customer_win', display_name: 'Customer Wins' },
  { key: 'pricing_updates', signal_type: 'pricing_update', display_name: 'Pricing Updates' },
  { key: 'hiring_trends', signal_type: 'hiring_trend', display_name: 'Hiring Trends' },
  { key: 'general_news', signal_type: 'general_news', display_name: 'General News' },
  { key: 'founder_contacts', signal_type: 'founder_contact', display_name: 'Founder Contacts' },
  { key: 'leading_indicators', signal_type: 'leading_indicator', display_name: 'Leading Indicators' },
  { key: 'competitive_landscape', signal_type: 'competitive_landscape', display_name: 'Competitive Landscape' },
  { key: 'fundraising_signals', signal_type: 'fundraising_signal', display_name: 'Fundraising Signals' },
];

export function normalizeReportData(raw: ReportData): ReportData {
  if (raw.sections && raw.sections.length > 0) return raw;
  const sections: ReportSection[] = [];
  for (const entry of LEGACY_SECTION_MAP) {
    const items = (raw as unknown as Record<string, unknown>)[entry.key] as ReportSignal[] | undefined;
    if (items && items.length > 0) {
      sections.push({ signal_type: entry.signal_type, display_name: entry.display_name, items });
    }
  }
  return { company_overview: raw.company_overview, sections, ai_summary: raw.ai_summary, ai_summary_type: raw.ai_summary_type };
}

export interface Report {
  report_id: string;
  company_id: string;
  generated_at: string;
  report_data: ReportData;
  trigger?: 'manual' | 'cron';
}

export interface AgentState {
  agentId: string;
  agentType: string;
  agentName: string;
  status: 'connecting' | 'browsing' | 'analyzing' | 'complete' | 'error';
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

export type EmailFrequency = 'daily' | 'every_3_days' | 'weekly' | 'monthly' | 'only_on_run';

export interface UserSettings {
  email: string | null;
  email_frequency: EmailFrequency;
}

export interface StopRunResult {
  report_id: string;
  report_data: ReportData;
  total_signals: number;
  email_sent: boolean;
}

// ---------- Organization API ----------

export async function getOrganizations(): Promise<Organization[]> {
  const res = await authFetch(`${API_BASE}/organizations`);
  return res.json();
}

export async function createOrganization(name: string): Promise<Organization> {
  const res = await authFetch(`${API_BASE}/organizations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  const data = await res.json();
  if (!res.ok) return { success: false, error: data.error || 'Failed to invite' };
  return data;
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  await authFetch(`${API_BASE}/organizations/${orgId}/members/${userId}`, { method: 'DELETE' });
}

export async function cancelInvitation(orgId: string, invitationId: string): Promise<void> {
  await authFetch(`${API_BASE}/organizations/${orgId}/invitations/${invitationId}`, { method: 'DELETE' });
}

// ---------- Company API ----------

export async function checkCompanyDomain(domain: string): Promise<{ exists: boolean; company?: Company }> {
  const res = await authFetch(`${API_BASE}/companies/check?domain=${encodeURIComponent(domain)}`);
  return res.json();
}

export async function getCompanies(): Promise<{ companies: Company[]; company_limit: number }> {
  const res = await authFetch(`${API_BASE}/companies`);
  const data = await res.json();
  return { companies: data.companies || [], company_limit: data.company_limit ?? 5 };
}

export async function deleteCompany(id: string): Promise<void> {
  await authFetch(`${API_BASE}/companies/${id}`, { method: 'DELETE' });
}

// ---------- Signal Definitions ----------

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
  scope?: 'global' | 'company';
  company_id?: string | null;
}): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  return result.definition;
}

export async function updateSignalDefinition(id: string, data: {
  name: string;
  signal_type: string;
  display_name: string;
  target_url: string;
  search_instructions: string;
}): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  return result.definition;
}

export async function toggleSignalDefinition(id: string): Promise<SignalDefinition> {
  const res = await authFetch(`${API_BASE}/signal-definitions/${id}/toggle`, { method: 'POST' });
  const result = await res.json();
  return result.definition;
}

export async function deleteSignalDefinition(id: string): Promise<void> {
  await authFetch(`${API_BASE}/signal-definitions/${id}`, { method: 'DELETE' });
}

// ---------- Reports ----------

export async function getReports(companyId?: string): Promise<Report[]> {
  const url = companyId ? `${API_BASE}/reports?company_id=${companyId}` : `${API_BASE}/reports`;
  const res = await authFetch(url);
  const data = await res.json();
  return data.reports || [];
}

export async function deleteReport(id: string): Promise<void> {
  await authFetch(`${API_BASE}/reports/${id}`, { method: 'DELETE' });
}

// ---------- User Settings ----------

export async function getUserSettings(): Promise<UserSettings> {
  const res = await authFetch(`${API_BASE}/user-settings`);
  return res.json();
}

export async function setEmailFrequency(frequency: EmailFrequency): Promise<void> {
  await authFetch(`${API_BASE}/user-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email_frequency: frequency }),
  });
}

// ---------- Run ----------

export async function stopRun(
  companyId: string,
  findings: Array<{ signal_type: string; title: string; summary: string; source: string; url?: string }>,
): Promise<StopRunResult> {
  const res = await authFetch(`${API_BASE}/stop-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, findings }),
  });
  return res.json();
}

// ---------- SSE ----------

const SSE_STALE_TIMEOUT = 90_000;

async function readSSE(
  response: Response,
  onEvent: (event: { type: string; data: unknown }) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
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
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const parsed = JSON.parse(line.slice(6));
          onEvent(parsed);
        } catch {
          // skip malformed
        }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ website_url: websiteUrl }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) { onError('Session expired. Please sign in again.'); return; }
          const err = await res.json().catch(() => ({ error: res.statusText }));
          onError(err.error || 'Failed to store company');
          return;
        }
        await readSSE(res, onEvent);
        onDone();
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') onError(err.message);
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ company_id: companyId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401) { onError('Session expired. Please sign in again.'); return; }
          const err = await res.json().catch(() => ({ error: res.statusText }));
          onError(err.error || 'Failed to run agents');
          return;
        }
        await readSSE(res, onEvent);
        onDone();
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') onError(err.message);
      });
  });

  return controller;
}
