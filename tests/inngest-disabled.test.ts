import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  INNGEST_DISABLED_MESSAGE,
  INNGEST_ENABLED,
} from "@/inngest/config";
import { functions } from "@/inngest/functions";
import { POST } from "@/app/api/trigger-pipeline/route";
import { enqueuePipelineRequestedEvent } from "@/services/pipeline-request-service";

describe("disabled Inngest integration", () => {
  it("does not register scheduled or event-driven functions", () => {
    expect(INNGEST_ENABLED).toBe(false);
    expect(functions).toEqual([]);
  });

  it("rejects pipeline API requests without emitting an event", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/trigger-pipeline", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: INNGEST_DISABLED_MESSAGE,
    });
  });

  it("blocks service-level event enqueueing before database work", async () => {
    await expect(
      enqueuePipelineRequestedEvent({ source: "manual" }),
    ).rejects.toThrow(INNGEST_DISABLED_MESSAGE);
  });
});
