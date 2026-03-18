import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import { ensureUser } from "@/services/user-service";
import {
  createOrganization,
  getOrganizationsForUser,
  seedDefaultDefinitions,
} from "@/services/organization-service";

export const POST = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  try {
    const user = await ensureUser(ctx.userId, ctx.userEmail);

    let orgs = await getOrganizationsForUser(ctx.userId);
    if (orgs.length === 0) {
      try {
        const orgName = ctx.userEmail
          ? `${ctx.userEmail.split("@")[0]}'s Workspace`
          : "My Workspace";
        const newOrg = await createOrganization(orgName, ctx.userId);
        await seedDefaultDefinitions(newOrg.organization_id).catch((err) =>
          console.error("[AUTH] Failed to seed signal definitions:", err),
        );
        orgs = [{ ...newOrg, role: "owner" }];
      } catch {
        orgs = await getOrganizationsForUser(ctx.userId);
      }
    }

    return Response.json({ success: true, user, organizations: orgs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[AUTH] Init failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
});
