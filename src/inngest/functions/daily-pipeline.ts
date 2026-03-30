import { cron } from "inngest";
import { PIPELINE_REQUESTED_EVENT } from "@/inngest/events";
import { inngest } from "../client";

function buildDailyRequestKey(date: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  return `cron:${day}`;
}

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
        requestKey: buildDailyRequestKey(new Date()),
      },
    });

    return {
      status: "queued",
    };
  },
);
