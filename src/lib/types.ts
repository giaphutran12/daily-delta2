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
  tracking_limit: number;
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
  added_by: string | null;
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
  platform_status: 'active' | 'pending_discovery' | 'enriching' | 'archived';
}

export interface TrackedCompany extends Company {
  tracked_at: string;
  tracked_by: string | null;
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
  detected_at: string | null;
  created_at: string;
  priority_score?: number;
  priority_tier?: "high" | "medium" | "low";
  company?: {
    company_id: string;
    company_name: string;
    industry: string | null;
    website_url: string;
  };
}

export interface Report {
  report_id: string;
  company_id: string;
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
}

export interface ReportSignal {
  title: string;
  summary: string;
  source: string;
  url?: string;
  detected_at: string;
}

// ---------- API Request / Response ----------

export interface AddCompanyRequest {
  website_url: string;
  page_title?: string;
}

export interface AddCompanyResponse {
  success: boolean;
  company: Company;
  already_existed: boolean;
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

// ---------- Signal Definitions ----------

export interface SignalDefinition {
  id: string;
  company_id: string | null;
  is_default: boolean;
  created_by: string | null;
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

// ---------- Chat ----------

export interface ChatSession {
  session_id: string;
  company_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  parts: unknown[] | null;
  created_at: string;
}

// ---------- Pipeline ----------

export interface PipelineResult {
  companiesProcessed: number;
  results: CompanyPipelineResult[];
  elapsed_seconds: number;
}

export interface CompanyPipelineResult {
  companyId: string;
  companyName: string;
  signalCount: number;
  reportId?: string;
  error?: string;
  findings: SignalFinding[];
}

export interface DigestCompany {
  company: Company;
  findings: SignalFinding[];
}

export interface CompetitorLink {
  organization_id: string;
  company_id: string;
  competitor_company_id: string;
  created_at: string;
  created_by: string | null;
  competitor: Company;
}
