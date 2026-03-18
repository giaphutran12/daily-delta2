import { cron } from "inngest";
import { inngest } from "../client";

export const dailyPipeline = inngest.createFunction(
  {
    id: "daily-pipeline",
    triggers: [cron("TZ=America/New_York 0 7 * * *")],
  },
  async ({ step }) => {
    // TODO: Task 12 — fan-out: load orgs → send org.process events
    console.log("[PIPELINE] Daily pipeline triggered");
    return { status: "stub" };
  }
);
