import { createAdminClient } from "@/lib/supabase/admin";
import { addMember } from "./organization-service";

const INVITE_TTL_DAYS = 7;

export async function createInvitation(
  orgId: string,
  email: string,
  role: "admin" | "member",
  invitedBy: string,
): Promise<{ token: string; alreadyPending: boolean }> {
  const supabase = createAdminClient();
  const normalizedEmail = email.toLowerCase();

  const { data: existingUser } = await supabase
    .from("users")
    .select("user_id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingUser) {
    const { data: existingMembership } = await supabase
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", existingUser.user_id)
      .maybeSingle();

    if (existingMembership) {
      throw new Error("User is already a member of this organization");
    }
  }

  const { data: existing } = await supabase
    .from("invitations")
    .select("id, token, expires_at, status")
    .eq("organization_id", orgId)
    .eq("email", normalizedEmail)
    .eq("status", "pending")
    .maybeSingle();

  if (existing) {
    if (new Date(existing.expires_at) > new Date()) {
      return { token: existing.token, alreadyPending: true };
    }
    await supabase
      .from("invitations")
      .update({ status: "expired" })
      .eq("id", existing.id);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

  const { data: inv, error } = await supabase
    .from("invitations")
    .insert({
      organization_id: orgId,
      email: normalizedEmail,
      role,
      invited_by: invitedBy,
      expires_at: expiresAt.toISOString(),
      token: crypto.randomUUID(),
    })
    .select("token")
    .single();

  if (error) throw new Error(`Failed to create invitation: ${error.message}`);
  return { token: inv.token, alreadyPending: false };
}

export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<{
  success: boolean;
  organizationId?: string;
  organizationName?: string;
  error?: string;
}> {
  const supabase = createAdminClient();

  const { data: inv } = await supabase
    .from("invitations")
    .select("id, organization_id, email, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!inv) {
    return { success: false, error: "Invitation not found" };
  }

  if (inv.status === "accepted") {
    return { success: false, error: "Invitation has already been accepted" };
  }

  if (inv.status === "expired" || new Date(inv.expires_at) < new Date()) {
    if (inv.status !== "expired") {
      await supabase
        .from("invitations")
        .update({ status: "expired" })
        .eq("id", inv.id);
    }
    return { success: false, error: "Invitation has expired" };
  }

  const { data: user } = await supabase
    .from("users")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return { success: false, error: "This invitation was sent to a different email address" };
  }

  try {
    await addMember(inv.organization_id, userId, inv.role);
  } catch (err: unknown) {
    const pgCode =
      (err as { code?: string })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode !== "23505") throw err;
  }

  await supabase
    .from("invitations")
    .update({ status: "accepted" })
    .eq("id", inv.id);

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("organization_id", inv.organization_id)
    .maybeSingle();

  return {
    success: true,
    organizationId: inv.organization_id,
    organizationName: org?.name,
  };
}

export async function getPendingInvitations(orgId: string): Promise<
  Array<{
    id: string;
    email: string;
    role: string;
    status: "pending";
    invited_by_email: string;
    created_at: string | null;
    expires_at: string;
  }>
> {
  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("invitations")
    .select("id, email, role, created_at, expires_at, invited_by")
    .eq("organization_id", orgId)
    .eq("status", "pending");

  if (error) throw new Error(`Failed to get pending invitations: ${error.message}`);
  if (!rows || rows.length === 0) return [];

  const inviterIds = [...new Set(rows.map((r) => r.invited_by))];
  const { data: inviters } = await supabase
    .from("users")
    .select("user_id, email")
    .in("user_id", inviterIds);

  const emailMap = new Map((inviters ?? []).map((u) => [u.user_id, u.email]));
  const now = new Date();

  return rows
    .filter((r) => new Date(r.expires_at) > now)
    .map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      status: "pending" as const,
      invited_by_email: emailMap.get(r.invited_by) ?? "",
      created_at: r.created_at,
      expires_at: r.expires_at,
    }));
}

export async function cancelInvitation(
  invitationId: string,
  orgId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", invitationId)
    .eq("organization_id", orgId)
    .eq("status", "pending");

  if (error) throw new Error(`Failed to cancel invitation: ${error.message}`);
}

export async function expireOldInvitations(): Promise<number> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    console.error("[INVITATIONS] Failed to expire old invitations:", error.message);
    return 0;
  }

  if (data && data.length > 0) {
    console.log(`[INVITATIONS] Expired ${data.length} old invitations`);
  }
  return data?.length ?? 0;
}
