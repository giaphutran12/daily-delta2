import { createAdminClient } from "@/lib/supabase/admin";
import { SignalDefinition } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToDefinition(row: Record<string, unknown>): SignalDefinition {
  return {
    id: row.id as string,
    company_id: (row.company_id as string) ?? null,
    is_default: (row.is_default as boolean) ?? false,
    created_by: (row.created_by as string) ?? null,
    name: row.name as string,
    signal_type: row.signal_type as string,
    display_name: row.display_name as string,
    target_url: row.target_url as string,
    search_instructions: row.search_instructions as string,
    scope: row.scope as "global" | "company",
    enabled: row.enabled as boolean,
    sort_order: row.sort_order as number,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get signal definitions for a company (platform-level).
 * Returns all global defaults + any custom signals for the specific company.
 */
export async function getSignalDefinitions(
  companyId?: string,
): Promise<SignalDefinition[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("signal_definitions")
    .select("*")
    .order("sort_order", { ascending: true });

  if (companyId) {
    // Global defaults (company_id IS NULL) + company-specific customs
    query = query.or(`company_id.is.null,company_id.eq.${companyId}`);
  } else {
    // Only global defaults
    query = query.is("company_id", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[SIGNAL_DEF] Failed to fetch definitions: ${error.message}`);
  return (data ?? []).map(rowToDefinition);
}

/**
 * Get a single signal definition by id.
 */
export async function getSignalDefinitionById(
  id: string,
): Promise<SignalDefinition | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("signal_definitions")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to fetch definition: ${error.message}`);
  return data ? rowToDefinition(data) : null;
}

// ---------------------------------------------------------------------------
// Create (custom signals only — defaults are platform-managed)
// ---------------------------------------------------------------------------

/**
 * Create a custom signal definition for a specific company.
 * Always scope='company', is_default=false.
 */
export async function createCustomSignal(data: {
  name: string;
  signal_type: string;
  display_name: string;
  target_url: string;
  search_instructions: string;
  company_id: string;
  created_by: string;
  enabled?: boolean;
  sort_order?: number;
}): Promise<SignalDefinition> {
  const supabase = createAdminClient();

  const { data: inserted, error } = await supabase
    .from("signal_definitions")
    .insert({
      company_id: data.company_id,
      is_default: false,
      created_by: data.created_by,
      name: data.name,
      signal_type: data.signal_type,
      display_name: data.display_name,
      target_url: data.target_url,
      search_instructions: data.search_instructions,
      scope: "company",
      enabled: data.enabled !== false,
      sort_order: data.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to create definition: ${error.message}`);
  return rowToDefinition(inserted);
}

// ---------------------------------------------------------------------------
// Update / Delete (guarded: defaults are locked)
// ---------------------------------------------------------------------------

/**
 * Update a signal definition (partial update).
 * Rejects updates to default (platform-managed) signals.
 */
export async function updateSignalDefinition(
  id: string,
  data: Partial<{
    name: string;
    signal_type: string;
    display_name: string;
    target_url: string;
    search_instructions: string;
    enabled: boolean;
    sort_order: number;
  }>,
): Promise<SignalDefinition | null> {
  const supabase = createAdminClient();

  // Check if this is a default signal
  const existing = await getSignalDefinitionById(id);
  if (!existing) return null;
  if (existing.is_default) {
    throw new Error("[SIGNAL_DEF] Cannot modify platform default signals");
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.signal_type !== undefined) updates.signal_type = data.signal_type;
  if (data.display_name !== undefined) updates.display_name = data.display_name;
  if (data.target_url !== undefined) updates.target_url = data.target_url;
  if (data.search_instructions !== undefined) updates.search_instructions = data.search_instructions;
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

  const { data: updated, error } = await supabase
    .from("signal_definitions")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to update definition: ${error.message}`);
  return updated ? rowToDefinition(updated) : null;
}

/**
 * Delete a signal definition by id.
 * Rejects deletion of default (platform-managed) signals.
 */
export async function deleteSignalDefinition(id: string): Promise<void> {
  const existing = await getSignalDefinitionById(id);
  if (!existing) return;
  if (existing.is_default) {
    throw new Error("[SIGNAL_DEF] Cannot delete platform default signals");
  }

  const supabase = createAdminClient();

  const { error } = await supabase
    .from("signal_definitions")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`[SIGNAL_DEF] Failed to delete definition: ${error.message}`);
}

/**
 * Toggle a signal definition enabled/disabled.
 * Works for both default and custom signals.
 */
export async function toggleSignalDefinition(
  id: string,
  enabled: boolean,
): Promise<SignalDefinition | null> {
  const supabase = createAdminClient();

  const { data: updated, error } = await supabase
    .from("signal_definitions")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw new Error(`[SIGNAL_DEF] Failed to toggle definition: ${error.message}`);
  return updated ? rowToDefinition(updated) : null;
}

