import { NextRequest } from "next/server";
import { withOrg, type OrgAuthContext } from "@/app/api/_lib/with-auth";
import { getOrganizationById } from "@/services/organization-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const GET = withOrg(async (_req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const org = await getOrganizationById(ctx.organizationId);
    if (!org) {
      return Response.json({ error: "Organization not found" }, { status: 404 });
    }
    return Response.json(org);
  } catch (err) {
    console.error("[ORGS] Failed to get organization:", err);
    return Response.json({ error: "Failed to get organization" }, { status: 500 });
  }
});

export const PATCH = withOrg(async (req: NextRequest, ctx: OrgAuthContext) => {
  try {
    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name && typeof body.name === "string") {
      updates.name = body.name.trim();
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("organizations")
      .update(updates)
      .eq("organization_id", ctx.organizationId)
      .select("organization_id, name, slug, tracking_limit, created_at")
      .single();

    if (error) throw error;
    return Response.json(data);
  } catch (err) {
    console.error("[ORGS] Failed to update organization:", err);
    return Response.json({ error: "Failed to update organization" }, { status: 500 });
  }
});
