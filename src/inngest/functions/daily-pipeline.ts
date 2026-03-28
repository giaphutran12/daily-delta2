import { cron } from "inngest";
import { inngest } from "../client";
import { runPipeline } from "@/services/pipeline-service";

export const dailyPipeline = inngest.createFunction(
  {
    id: "daily-pipeline",
    triggers: [cron("TZ=America/New_York 0 7 * * *")],
  },
  async ({ step }) => {
    const result = await step.run("run-pipeline", async () => runPipeline());

    return {
      status: result.companiesProcessed > 0 ? "completed" : "no-op",
      companiesProcessed: result.companiesProcessed,
      elapsed_seconds: result.elapsed_seconds,
    };
  },
);
