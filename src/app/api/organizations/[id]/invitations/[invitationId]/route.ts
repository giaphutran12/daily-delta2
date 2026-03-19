import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getMemberRole } from "@/services/organization-service";
import { cancelInvitation } from "@/services/invitation-service";

export const DELETE = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const invitationId = parts[parts.length - 1];

    if (!invitationId) {
      return Response.json({ error: "Invitation ID is required" }, { status: 400 });
    }

    const callerRole = await getMemberRole(ctx.organizationId, ctx.userId);
    if (!callerRole || !["owner", "admin"].includes(callerRole)) {
      return Response.json(
        { error: "Only owners and admins can cancel invitations" },
        { status: 403 },
      );
    }

    await cancelInvitation(invitationId, ctx.organizationId);
    return Response.json({ success: true });
  } catch (err) {
    console.error("[ORGS] Failed to cancel invitation:", err);
    return Response.json({ error: "Failed to cancel invitation" }, { status: 500 });
  }
});
