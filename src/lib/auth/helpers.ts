import { createClient } from "@/lib/supabase/server";

export interface ServerUser {
  userId: string;
  userEmail: string;
}

export async function getServerUser(): Promise<ServerUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    userId: user.id,
    userEmail: user.email ?? "",
  };
}
