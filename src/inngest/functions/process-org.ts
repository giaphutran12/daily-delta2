import { inngest } from "../client";
import { orgProcess } from "../events";

export const processOrg = inngest.createFunction(
  {
    id: "process-org",
    triggers: [{ event: orgProcess }],
    concurrency: [{ limit: 3, key: "event.data.organizationId" }],
  },
  async ({ event, step }) => {
    // TODO: Task 12 — fan-out: load companies → send company.process events
    console.log("[PIPELINE] Processing org:", event.data.organizationId);
    return { status: "stub", organizationId: event.data.organizationId };
  }
);
