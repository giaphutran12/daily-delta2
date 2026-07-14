import { INNGEST_ENABLED } from "@/inngest/config";
import { dailyPipeline } from "./daily-pipeline";
import {
  companyRunCompleted,
  finalizePipelineRequest,
  pipelineRequested,
  processCompanyPipelineRun,
} from "./pipeline-workflow";

const configuredFunctions = [
  dailyPipeline,
  pipelineRequested,
  processCompanyPipelineRun,
  companyRunCompleted,
  finalizePipelineRequest,
];

// Syncing the deployed endpoint with an empty list deregisters the cron and
// event-driven workers while leaving the implementation available to restore.
export const functions = INNGEST_ENABLED ? configuredFunctions : [];
