import { cron } from "inngest";
import { PIPELINE_REQUESTED_EVENT } from "@/inngest/events";
import { inngest } from "../client";

export const dailyPipeline = inngest.createFunction(
  {
    id: "daily-pipeline",
    triggers: [cron("TZ=America/New_York 0 7 * * *")],
  },
  async ({ step }) => {
    await step.sendEvent("queue-daily-pipeline-request", {
      name: PIPELINE_REQUESTED_EVENT,
      data: {
        source: "cron",
      },
    });

    return {
      status: "queued",
    };
  },
);
