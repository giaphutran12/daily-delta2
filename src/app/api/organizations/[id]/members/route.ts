import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import {
  getOrganizationById,
  getOrganizationMembers,
  getMemberRole,
} from "@/services/organization-service";
import {
  createInvitation,
  getPendingInvitations,
  expireOldInvitations,
} from "@/services/invitation-service";
import { sendInviteEmail } from "@/services/email-service";

export const GET = withOrg(async (_req: NextRequest, ctx: OrgAuthContext) => {
  try {
    await expireOldInvitations();

    const members = await getOrganizationMembers(ctx.organizationId);
    const pending = await getPendingInvitations(ctx.organizationId);

    const combined = [
      ...members.map((m) => ({ ...m, status: "active" })),
      ...pending.map((p) => ({
        id: p.id,
        organization_id: ctx.organizationId,
        user_id: null,
        email: p.email,
        role: p.role,
        joined_at: p.created_at,
        status: "pending",
        expires_at: p.expires_at,
        invited_by_email: p.invited_by_email,
      })),
    ];

    return Response.json(combined);
  } catch (err) {
    console.error("[ORGS] Failed to list members:", err);
    return Response.json({ error: "Failed to list members" }, { status: 500 });
  }
});

export const POST = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const { email, role: inviteRole } = await req.json();

    if (!email || typeof email !== "string") {
      return Response.json({ error: "Email is required" }, { status: 400 });
    }

    const callerRole = await getMemberRole(ctx.organizationId, ctx.userId);
    if (!callerRole || !["owner", "admin"].includes(callerRole)) {
      return Response.json(
        { error: "Only owners and admins can invite members" },
        { status: 403 },
      );
    }

    const memberRole = inviteRole === "admin" ? "admin" : "member";
    const org = await getOrganizationById(ctx.organizationId);
    const orgName = org?.name || "an organization";

    const { token, alreadyPending } = await createInvitation(
      ctx.organizationId,
      email.trim(),
      memberRole,
      ctx.userId,
    );

    const emailSent = await sendInviteEmail(email.trim(), orgName, ctx.userEmail, memberRole, token);
    if (!emailSent) {
      console.warn(`[ORGS] Invitation created but email failed to send for ${email.trim()}`);
    }

    return Response.json({
      success: true,
      pending: true,
      token,
      organization_name: orgName,
      message: alreadyPending
        ? `Invitation re-sent to ${email.trim()}`
        : `Invitation sent to ${email.trim()}. They have 7 days to accept.`,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "User is already a member of this organization") {
      return Response.json({ error: err.message }, { status: 409 });
    }
    console.error("[ORGS] Failed to invite member:", err);
    return Response.json({ error: "Failed to invite member" }, { status: 500 });
  }
});
