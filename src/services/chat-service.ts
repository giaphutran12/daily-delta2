import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatSession, ChatMessage } from "@/lib/types";

export async function getOrCreateSession(
  companyId: string,
  userId: string,
): Promise<ChatSession> {
  const supabase = createAdminClient();

  // Upsert: insert if not exists, then select
  await supabase
    .from("chat_sessions")
    .insert({ company_id: companyId, user_id: userId })
    .select()
    .maybeSingle();

  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(`Failed to get/create chat session: ${error.message}`);
  return data as ChatSession;
}

export async function getSessionMessages(
  sessionId: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed to get chat messages: ${error.message}`);
  return (data ?? []) as ChatMessage[];
}

export async function saveMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  parts?: unknown[] | null,
): Promise<ChatMessage> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      role,
      content,
      parts: parts ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save chat message: ${error.message}`);
  return data as ChatMessage;
}

export async function updateSessionTimestamp(
  sessionId: string,
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("session_id", sessionId);

  if (error) throw new Error(`Failed to update session timestamp: ${error.message}`);
}
