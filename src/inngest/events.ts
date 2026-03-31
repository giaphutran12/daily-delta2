export const PIPELINE_REQUESTED_EVENT = "daily-delta/pipeline.requested" as const;
export const COMPANY_REQUESTED_EVENT = "daily-delta/company.requested" as const;
export const COMPANY_COMPLETED_EVENT = "daily-delta/company.completed" as const;
export const PIPELINE_FINALIZE_EVENT = "daily-delta/pipeline.finalize" as const;

export type PipelineRequestSource = "cron" | "manual" | "refresh";

export interface PipelineRequestedEventData {
  source: PipelineRequestSource;
  requestId?: string;
  requestKey?: string;
  companyIds?: string[];
  organizationId?: string;
  requestedByUserId?: string;
  recipientUserIds?: string[];
}

export interface CompanyRequestedEventData {
  companyRunId: string;
  companyId: string;
}

export interface CompanyCompletedEventData {
  companyRunId: string;
}

export interface PipelineFinalizeEventData {
  requestId: string;
}
