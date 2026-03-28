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

/**
 * Set the custom report delivery email for a user.
 * This writes to `delivery_email` — a separate column from `email`.
 * `users.email` is the identity email and is never changed here.
 */
export async function setUserEmail(
  userId: string,
  deliveryEmail: string,
): Promise<User> {
  const supabase = createAdminClient();

  // Ensure the user row exists before trying to update it
  await ensureUser(userId, deliveryEmail);

  const { data, error } = await supabase
    .from("users")
    .update({ delivery_email: deliveryEmail })
    .eq("user_id", userId)
    .select("user_id, email, created_at")
    .single();

  if (error) throw new Error(`Failed to update delivery email: ${error.message}`);
  return rowToUser(data);
}

/**
 * Return the best available email address to use for pipeline report delivery.
 * Priority: delivery_email (custom) → email (identity / auth email).
 */
export async function getUserEmail(
  userId: string,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("email, delivery_email")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  return (data.delivery_email as string | null) ?? data.email ?? null;
}

/**
 * Return the user's current settings.
 * `email` in the response is the DELIVERY email — the custom override if set,
 * otherwise null (frontend falls back to auth session email).
 */
export async function getUserSettings(userId: string): Promise<{
  email: string | null;
}> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("users")
    .select("delivery_email")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    email: (data?.delivery_email as string | null) ?? null,
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
