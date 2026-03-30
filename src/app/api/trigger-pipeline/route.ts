import { NextRequest, NextResponse } from "next/server";
import { enqueuePipelineRequestedEvent } from "@/services/pipeline-request-service";

export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { company_id?: string; company_ids?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — process all companies
  }

  const ids = body.company_ids ?? (body.company_id ? [body.company_id] : undefined);
  console.log("[PIPELINE] Trigger received, companies:", ids ? ids.length + " specified" : "(all)");

  try {
    await enqueuePipelineRequestedEvent("manual", ids);

    return NextResponse.json(
      {
        status: "queued",
        source: "manual",
        requested_company_count: ids?.length ?? null,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("[PIPELINE] Fatal error:", error);
    return NextResponse.json(
      {
        error: "Pipeline failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
