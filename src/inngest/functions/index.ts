import { INNGEST_ENABLED } from "@/inngest/config";
import { inngest } from "@/inngest/client";
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

// Inngest refuses to sync an app with zero functions. Keep one inert,
// event-only tombstone so a production sync can remove every old cron and
// workflow registration without creating any scheduled runs.
export const inngestDisabledTombstone = inngest.createFunction(
  {
    id: "inngest-disabled",
    triggers: [{ event: "daily-delta/inngest-disabled.noop" }],
  },
  async () => ({ status: "disabled" }),
);

export const functions = INNGEST_ENABLED
  ? configuredFunctions
  : [inngestDisabledTombstone];
