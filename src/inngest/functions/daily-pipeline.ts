import { cron } from "inngest";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest } from "../client";

export const dailyPipeline = inngest.createFunction(
  {
    id: "daily-pipeline",
    triggers: [cron("TZ=America/New_York 0 7 * * *")],
  },
  async ({ step }) => {
    const organizationIds = await step.run("load-active-orgs", async () => {
      const supabase = createAdminClient();
      const { data, error } = await supabase
        .from("companies")
        .select("organization_id")
        .eq("tracking_status", "active")
        .not("organization_id", "is", null);

      if (error) {
        throw new Error(`[PIPELINE] Failed to load active orgs: ${error.message}`);
      }

      return Array.from(
        new Set((data ?? []).map((row) => row.organization_id).filter(Boolean)),
      );
    });

    if (organizationIds.length === 0) {
      console.log("[PIPELINE] No organizations with active companies");
      return { status: "no-op", organizations: 0 };
    }

    await step.sendEvent(
      "fan-out-orgs",
      organizationIds.map((organizationId) => ({
        name: "daily-delta/org.process",
        data: { organizationId },
      })),
    );

    console.log(
      "[PIPELINE] Queued org processing events: %d",
      organizationIds.length,
    );

    return {
      status: "queued",
      organizations: organizationIds.length,
    };
  }
);
