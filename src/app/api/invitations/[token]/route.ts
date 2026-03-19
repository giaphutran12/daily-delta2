import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: inv } = await supabase
    .from("invitations")
    .select("id, organization_id, email, role, status, expires_at, invited_by")
    .eq("token", token)
    .maybeSingle();

  if (!inv) {
    return Response.json({ error: "Invitation not found" }, { status: 404 });
  }

  if (
    inv.status === "accepted" ||
    inv.status === "expired" ||
    new Date(inv.expires_at) < new Date()
  ) {
    return Response.json(
      { error: "Invitation has expired or already been used" },
      { status: 410 },
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("organization_id", inv.organization_id)
    .maybeSingle();

  const { data: inviter } = await supabase
    .from("users")
    .select("email")
    .eq("user_id", inv.invited_by)
    .maybeSingle();

  return Response.json({
    id: inv.id,
    organization_id: inv.organization_id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expires_at: inv.expires_at,
    invited_by: inv.invited_by,
    organization_name: org?.name,
    invited_by_email: inviter?.email,
  });
}
