import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@/lib/types";

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
): Promise<User> {
  const supabase = createAdminClient();
  await ensureUser(userId, email);

  const { data, error } = await supabase
    .from("users")
    .update({ email })
    .eq("user_id", userId)
    .select("user_id, email, created_at")
    .single();

  if (error) throw new Error(`Failed to update email: ${error.message}`);
  return rowToUser(data);
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
}> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    email: data?.email ?? null,
  };
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
