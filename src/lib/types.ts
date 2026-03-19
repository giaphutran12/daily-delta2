// ============================================
// Shared Types for Daily Delta
// ============================================

// ---------- Database Entities ----------

export interface User {
  user_id: string;
  email: string;
  created_at: string;
}

export interface Organization {
  organization_id: string;
  name: string;
  slug: string;
  company_limit: number;
  created_at: string;
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
  user_id: string;
  organization_id: string | null;
  company_name: string;
  website_url: string;
  domain: string;
  description: string | null;
  industry: string | null;
  founding_year: number | null;
  headquarters: string | null;
  company_size: string | null;
  detected_products: string[] | null;
  careers_url: string | null;
  blog_url: string | null;
  pricing_url: string | null;
  created_at: string;
  last_agent_run: string | null;
  tracking_status: 'active' | 'paused' | 'archived';
}

export type SignalType = string;

export interface Signal {
  signal_id: string;
  company_id: string;
  signal_type: SignalType;
  source: string;
  title: string;
  content: string;
  url: string | null;
  detected_at: string;
}

export interface Report {
  report_id: string;
  company_id: string;
  organization_id?: string | null;
  generated_at: string;
  report_data: ReportData;
  trigger?: 'manual' | 'cron';
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
  // Legacy fields for backward compat with old stored reports
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

/**
 * Normalize old 12-property format reports into sections[] format
 */
export function normalizeReportData(raw: ReportData): ReportData {
  if (raw.sections && raw.sections.length > 0) return raw;

  const LEGACY_MAP: Array<{ key: string; signal_type: string; display_name: string }> = [
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

  const sections: ReportSection[] = [];
  for (const entry of LEGACY_MAP) {
    const items = (raw as unknown as Record<string, unknown>)[entry.key] as ReportSignal[] | undefined;
    if (items && items.length > 0) {
      sections.push({
        signal_type: entry.signal_type,
        display_name: entry.display_name,
        items,
      });
    }
  }

  return {
    company_overview: raw.company_overview,
    sections,
    ai_summary: raw.ai_summary,
    ai_summary_type: raw.ai_summary_type,
  };
}

export interface ReportSignal {
  title: string;
  summary: string;
  source: string;
  url?: string;
  detected_at: string;
}

// ---------- API Request / Response ----------

export interface StoreCompanyRequest {
  website_url: string;
  page_title?: string;
}

export interface StoreCompanyResponse {
  success: boolean;
  company: Company;
}

export interface RunAgentsRequest {
  company_id: string;
}

export interface SetEmailRequest {
  email: string;
}

export interface CreateOrganizationRequest {
  name: string;
}

export interface InviteMemberRequest {
  email: string;
  role?: 'admin' | 'member';
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  token: string;
  invited_by: string;
  status: 'pending' | 'accepted' | 'expired';
  expires_at: string;
  created_at: string;
}

export interface InvitationWithOrg extends Invitation {
  organization_name?: string;
  invited_by_email?: string;
}

// ---------- Agent System ----------

export type AgentType = string;

export interface AgentConfig {
  id: string;
  type: AgentType;
  name: string;
  url: string;
  goal: string;
  company_id: string;
}

export type AgentStatus =
  | 'idle'
  | 'connecting'
  | 'browsing'
  | 'analyzing'
  | 'complete'
  | 'error';

export interface AgentStatusUpdate {
  agentId: string;
  agentType: AgentType;
  agentName: string;
  status: AgentStatus;
  message?: string;
  streamingUrl?: string;
  progress?: number;
  findings?: AgentFindings;
  error?: string;
}

export interface AgentFindings {
  signals: SignalFinding[];
  metadata?: Record<string, unknown>;
}

export interface SignalFinding {
  signal_type: SignalType;
  title: string;
  summary: string;
  source: string;
  url?: string;
  detected_at?: string;
  signal_definition_id?: string;
}

// ---------- SSE Events ----------

export type SSEEventType =
  | 'agent_connecting'
  | 'agent_browsing'
  | 'agent_streaming_url'
  | 'agent_status'
  | 'agent_complete'
  | 'agent_error'
  | 'pipeline_complete'
  | 'pipeline_error'
  | 'discovery_complete';

export interface SSEEvent {
  type: SSEEventType;
  data: AgentStatusUpdate | { message: string } | Company;
}

// ---------- Signal Definitions ----------

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
  created_at?: string;
  updated_at?: string;
}

// ---------- Discovery Agent Output ----------

export interface DiscoveryResult {
  company_name: string;
  description: string;
  industry: string;
  products: string[];
  headquarters: string;
  founding_year: number | null;
  company_size: string;
  leadership: string[];
  careers_url: string;
  blog_url: string;
  pricing_url: string;
  pricing_model: string;
}
