import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/services/pipeline-service";

export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { company_id?: string } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — process all companies
  }

  console.log("[PIPELINE] Trigger received, company_id:", body.company_id ?? "(all companies)");

  try {
    const result = await runPipeline(body.company_id);

    return NextResponse.json({
      status: result.companiesProcessed > 0 ? "completed" : "no-op",
      ...result,
    });
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
