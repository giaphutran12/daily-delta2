import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getMemberRole, removeMember } from "@/services/organization-service";

export const DELETE = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const userId = parts[parts.length - 1];

    if (!userId) {
      return Response.json({ error: "User ID is required" }, { status: 400 });
    }

    const callerRole = await getMemberRole(ctx.organizationId, ctx.userId);
    if (!callerRole || !["owner", "admin"].includes(callerRole)) {
      return Response.json(
        { error: "Only owners and admins can remove members" },
        { status: 403 },
      );
    }

    await removeMember(ctx.organizationId, userId);
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove member";
    const status = message.includes("last owner") ? 400 : 500;
    return Response.json({ error: message }, { status });
  }
});
