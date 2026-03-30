import { NextRequest, NextResponse } from "next/server";
import {
  ApiAuthError,
  authenticateRequest,
  verifyOrganizationMembership,
} from "@/lib/auth/api-auth";
import { getOrganizationMembers } from "@/services/organization-service";
import { ensureUser } from "@/services/user-service";
import { enqueuePipelineRequestedEvent } from "@/services/pipeline-request-service";

export const maxDuration = 800;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  const isCronRequest = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  let body: {
    company_id?: string;
    company_ids?: string[];
    recipient_user_ids?: string[];
    request_key?: string;
  } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — process all companies
  }

  const ids = body.company_ids ?? (body.company_id ? [body.company_id] : undefined);
  console.log("[PIPELINE] Trigger received, companies:", ids ? ids.length + " specified" : "(all)");

  try {
    if (isCronRequest) {
      const queued = await enqueuePipelineRequestedEvent({
        source: "cron",
        requestKey: body.request_key,
        companyIds: ids,
      });

      return NextResponse.json(
        {
          status: "queued",
          source: "cron",
          requestId: queued.requestId,
          requestKey: queued.requestKey,
          requestedCompanyCount: ids?.length ?? null,
        },
        { status: 202 },
      );
    }

    const user = await authenticateRequest(request);
    const organizationId = request.headers.get("x-organization-id")?.trim();
    if (!organizationId) {
      throw new ApiAuthError(400, "X-Organization-Id header is required");
    }

    await verifyOrganizationMembership(user.userId, organizationId);
    await ensureUser(user.userId, user.userEmail);

    if (body.recipient_user_ids?.length) {
      const members = await getOrganizationMembers(organizationId);
      const memberUserIds = new Set(
        members
          .filter((member): member is typeof member & { user_id: string } => !!member.user_id)
          .map((member) => member.user_id),
      );

      const invalidRecipientIds = body.recipient_user_ids.filter(
        (userId) => !memberUserIds.has(userId),
      );

      if (invalidRecipientIds.length > 0) {
        return NextResponse.json(
          { error: "Manual recipients must belong to the selected organization" },
          { status: 400 },
        );
      }
    }

    const queued = await enqueuePipelineRequestedEvent({
      source: "manual",
      requestKey: body.request_key,
      companyIds: ids,
      organizationId,
      requestedByUserId: user.userId,
      recipientUserIds: body.recipient_user_ids,
    });

    return NextResponse.json(
      {
        status: "queued",
        source: "manual",
        requestId: queued.requestId,
        requestKey: queued.requestKey,
        requestedCompanyCount: ids?.length ?? null,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

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
