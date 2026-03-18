import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import { acceptInvitation } from "@/services/invitation-service";

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    const { token } = await req.json();

    if (!token) {
      return Response.json({ error: "Invitation token is required" }, { status: 400 });
    }

    const result = await acceptInvitation(token, ctx.userId);

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({
      success: true,
      organization_id: result.organizationId,
      organization_name: result.organizationName,
      message: `You've joined ${result.organizationName}!`,
    });
  } catch (err) {
    console.error("[INVITATIONS] Failed to accept invitation:", err);
    return Response.json({ error: "Failed to accept invitation" }, { status: 500 });
  }
});
