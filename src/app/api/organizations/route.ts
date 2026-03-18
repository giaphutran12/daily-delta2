import { NextRequest } from "next/server";
import { withAuth, type AuthContext } from "@/app/api/_lib/with-auth";
import {
  createOrganization,
  getOrganizationsForUser,
} from "@/services/organization-service";

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  try {
    const orgs = await getOrganizationsForUser(ctx.userId);
    return Response.json(orgs);
  } catch (err) {
    console.error("[ORGS] Failed to list organizations:", err);
    return Response.json({ error: "Failed to list organizations" }, { status: 500 });
  }
});

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    const { name } = await req.json();

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return Response.json({ error: "Organization name is required" }, { status: 400 });
    }

    const org = await createOrganization(name.trim(), ctx.userId);
    return Response.json({ success: true, organization: org });
  } catch (err) {
    console.error("[ORGS] Failed to create organization:", err);
    return Response.json({ error: "Failed to create organization" }, { status: 500 });
  }
});
