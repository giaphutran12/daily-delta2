import { createAdminClient } from "@/lib/supabase/admin";
import type { Organization, OrganizationMember } from "@/lib/types";
import { DEFAULT_SIGNAL_DEFINITIONS } from "./signal-defaults";

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function createOrganization(
  name: string,
  ownerUserId: string,
): Promise<Organization> {
  const supabase = createAdminClient();
  const slug = generateSlug(name);

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, slug })
    .select("organization_id, name, slug, company_limit, created_at")
    .single();

  if (orgError) throw new Error(`Failed to create org: ${orgError.message}`);

  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({
      organization_id: org.organization_id,
      user_id: ownerUserId,
      role: "owner",
    });

  if (memberError) throw new Error(`Failed to add owner: ${memberError.message}`);

  return {
    organization_id: org.organization_id,
    name: org.name,
    slug: org.slug,
    company_limit: org.company_limit,
    created_at: org.created_at ?? new Date().toISOString(),
  };
}

export async function getOrganizationCompanyLimit(orgId: string): Promise<number> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("organizations")
    .select("company_limit")
    .eq("organization_id", orgId)
    .maybeSingle();

  return data?.company_limit ?? 5;
}

export async function getOrganizationsForUser(
  userId: string,
): Promise<(Organization & { role: string })[]> {
  const supabase = createAdminClient();

  const { data: memberships, error } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to get memberships: ${error.message}`);
  if (!memberships || memberships.length === 0) return [];

  const orgIds = memberships.map((m) => m.organization_id);
  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("organization_id, name, slug, company_limit, created_at")
    .in("organization_id", orgIds);

  if (orgsError) throw new Error(`Failed to get orgs: ${orgsError.message}`);

  const roleMap = new Map(memberships.map((m) => [m.organization_id, m.role]));

  return (orgs ?? []).map((o) => ({
    organization_id: o.organization_id,
    name: o.name,
    slug: o.slug,
    company_limit: o.company_limit,
    created_at: o.created_at ?? "",
    role: roleMap.get(o.organization_id) ?? "member",
  }));
}

export async function getOrganizationById(
  orgId: string,
): Promise<Organization | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("organizations")
    .select("organization_id, name, slug, company_limit, created_at")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (!data) return null;
  return {
    organization_id: data.organization_id,
    name: data.name,
    slug: data.slug,
    company_limit: data.company_limit,
    created_at: data.created_at ?? "",
  };
}

export async function getOrganizationMembers(
  orgId: string,
): Promise<OrganizationMember[]> {
  const supabase = createAdminClient();

  const { data: members, error } = await supabase
    .from("organization_members")
    .select("id, organization_id, user_id, role, joined_at")
    .eq("organization_id", orgId);

  if (error) throw new Error(`Failed to get members: ${error.message}`);
  if (!members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: users } = await supabase
    .from("users")
    .select("user_id, email")
    .in("user_id", userIds);

  const emailMap = new Map((users ?? []).map((u) => [u.user_id, u.email]));

  return members.map((m) => ({
    id: m.id,
    organization_id: m.organization_id,
    user_id: m.user_id,
    role: m.role as "owner" | "admin" | "member",
    joined_at: m.joined_at ?? "",
    email: emailMap.get(m.user_id),
  }));
}

export async function getMemberRole(
  orgId: string,
  userId: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  return data?.role ?? null;
}

export async function addMember(
  orgId: string,
  userId: string,
  role: string = "member",
): Promise<OrganizationMember> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("organization_members")
    .insert({
      organization_id: orgId,
      user_id: userId,
      role,
    })
    .select("id, organization_id, user_id, role, joined_at")
    .single();

  if (error) throw new Error(`Failed to add member: ${error.message}`);

  return {
    id: data.id,
    organization_id: data.organization_id,
    user_id: data.user_id,
    role: data.role as "owner" | "admin" | "member",
    joined_at: data.joined_at ?? "",
  };
}

export async function removeMember(
  orgId: string,
  userId: string,
): Promise<void> {
  const members = await getOrganizationMembers(orgId);
  const owners = members.filter((m) => m.role === "owner");
  const target = members.find((m) => m.user_id === userId);

  if (target?.role === "owner" && owners.length <= 1) {
    throw new Error("Cannot remove the last owner of an organization");
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("organization_members")
    .delete()
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to remove member: ${error.message}`);
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("organization_members")
    .update({ role })
    .eq("organization_id", orgId)
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to update role: ${error.message}`);
}

export async function seedDefaultDefinitions(orgId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("signal_definitions")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1);

  if (existing && existing.length > 0) return;

  const now = new Date().toISOString();
  const rows = DEFAULT_SIGNAL_DEFINITIONS.map((def, i) => ({
    id: crypto.randomUUID(),
    organization_id: orgId,
    company_id: null,
    name: def.name,
    signal_type: def.signal_type,
    display_name: def.display_name,
    target_url: def.target_url,
    search_instructions: def.search_instructions,
    scope: "global",
    enabled: true,
    sort_order: i,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("signal_definitions")
    .insert(rows);

  if (error) {
    console.error("[ORG] Failed to seed signal definitions:", error.message);
  }
}
