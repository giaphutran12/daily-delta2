import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@/lib/types";

export type EmailFrequency =
  | "daily"
  | "every_3_days"
  | "weekly"
  | "monthly";

export async function ensureUser(
  userId: string,
  email: string,
): Promise<User> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("users")
    .select("user_id, email, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return rowToUser(existing);

  const { data: inserted, error } = await supabase
    .from("users")
    .upsert(
      { user_id: userId, email },
      { onConflict: "email" },
    )
    .select("user_id, email, created_at")
    .single();

  if (error) throw new Error(`Failed to ensure user: ${error.message}`);
  return rowToUser(inserted);
}

export async function setUserEmail(
  userId: string,
  email: string,
  emailFrequency?: EmailFrequency,
): Promise<User> {
  const supabase = createAdminClient();
  await ensureUser(userId, email);

  const updates: Record<string, unknown> = { email };
  if (emailFrequency) updates.email_frequency = emailFrequency;

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("user_id", userId)
    .select("user_id, email, created_at")
    .single();

  if (error) throw new Error(`Failed to update email: ${error.message}`);
  return rowToUser(data);
}

export async function setEmailFrequency(
  userId: string,
  frequency: EmailFrequency,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("users")
    .update({ email_frequency: frequency })
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to update frequency: ${error.message}`);
}

export async function getUserEmail(
  userId: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.email ?? null;
}

export async function getUserSettings(userId: string): Promise<{
  email: string | null;
  email_frequency: EmailFrequency;
}> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("email, email_frequency")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    email: data?.email ?? null,
    email_frequency: (data?.email_frequency as EmailFrequency) ?? "daily",
  };
}

export async function getAllUsers(): Promise<
  Array<{ user_id: string; email: string; email_frequency: EmailFrequency }>
> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("users")
    .select("user_id, email, email_frequency");

  if (error) throw new Error(`Failed to get all users: ${error.message}`);

  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    email: r.email,
    email_frequency: (r.email_frequency as EmailFrequency) ?? "daily",
  }));
}

export async function getUserByEmail(
  email: string,
): Promise<User | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("user_id, email, created_at")
    .eq("email", email)
    .maybeSingle();

  if (!data) return null;
  return rowToUser(data);
}

function rowToUser(row: {
  user_id: string;
  email: string;
  created_at: string | null;
}): User {
  return {
    user_id: row.user_id,
    email: row.email,
    created_at: row.created_at ?? new Date().toISOString(),
  };
}
