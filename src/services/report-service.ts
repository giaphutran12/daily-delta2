import { createAdminClient } from "@/lib/supabase/admin";
import {
  Report,
  ReportData,
  ReportSignal,
  ReportSection,
  Company,
  SignalFinding,
  SignalDefinition,
} from "@/lib/types";

/** Sort signals by detected_at descending (latest first) */
function sortByDateDesc(items: ReportSignal[]): ReportSignal[] {
  return items.sort(
    (a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
  );
}

/** Default display names for known signal types (fallback when no definitions provided) */
const DEFAULT_DISPLAY_NAMES: Record<string, string> = {
  product_launch: "Product Launches",
  financing: "Financings",
  leadership_change: "Leadership Changes",
  revenue_milestone: "Revenue Milestones",
  customer_win: "Customer Wins",
  pricing_update: "Pricing Updates",
  hiring_trend: "Hiring Trends",
  general_news: "General News",
  founder_contact: "Founder Contacts",
  leading_indicator: "Leading Indicators",
  competitive_landscape: "Competitive Landscape",
  fundraising_signal: "Fundraising Signals",
  partnership: "Partnerships",
};

/**
 * Build a display name lookup from definitions
 */
function buildDisplayNameMap(
  definitions?: SignalDefinition[],
): Record<string, string> {
  const map = { ...DEFAULT_DISPLAY_NAMES };
  if (definitions) {
    for (const def of definitions) {
      map[def.signal_type] = def.display_name;
    }
  }
  return map;
}

/**
 * Group items by signal_type into ReportSection[]
 */
function buildSections(
  items: (ReportSignal & { signal_type: string })[],
  signalTypes: string[],
  displayNames: Record<string, string>,
): ReportSection[] {
  const grouped = new Map<string, ReportSignal[]>();

  for (const item of items) {
    const type = item.signal_type || "general_news";
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type)!.push(item);
  }

  // Build sections in definition order, then any remaining types
  const sections: ReportSection[] = [];
  const seen = new Set<string>();

  for (const type of signalTypes) {
    if (grouped.has(type)) {
      seen.add(type);
      sections.push({
        signal_type: type,
        display_name: displayNames[type] || type,
        items: sortByDateDesc(grouped.get(type)!),
      });
    }
  }

  // Any types not in definitions go at the end
  for (const [type, sectionItems] of grouped) {
    if (!seen.has(type)) {
      sections.push({
        signal_type: type,
        display_name: displayNames[type] || "General",
        items: sortByDateDesc(sectionItems),
      });
    }
  }

  return sections;
}

/**
 * Generate a structured intelligence report directly from agent findings
 */
export function generateReportFromFindings(
  company: Company,
  findings: SignalFinding[],
  definitions?: SignalDefinition[],
): ReportData {
  const displayNames = buildDisplayNameMap(definitions);
  const signalTypes = definitions
    ? definitions.map((d) => d.signal_type)
    : Object.keys(DEFAULT_DISPLAY_NAMES);

  const reportSignals = findings.map((f) => ({
    signal_type: f.signal_type,
    title: f.title,
    summary: f.summary,
    source: f.source,
    url: f.url || undefined,
    detected_at: f.detected_at || new Date().toISOString(),
  }));

  return {
    company_overview:
      company.description || `Intelligence report for ${company.company_name}`,
    sections: buildSections(reportSignals, signalTypes, displayNames),
  };
}

/**
 * Store report in database (platform-level, per company)
 */
export async function storeReport(
  companyId: string,
  reportData: ReportData,
  trigger: "manual" | "cron" = "cron",
): Promise<Report> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reports")
    .insert({
      company_id: companyId,
      generated_at: new Date().toISOString(),
      report_data: reportData,
      trigger,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to store report: ${error.message}`);

  return rowToReport(data);
}

/**
 * Get a single report by ID
 */
export async function getReportById(
  reportId: string,
): Promise<Report | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("report_id", reportId)
    .single();

  if (error || !data) return null;
  return rowToReport(data);
}

/**
 * Get reports for a specific company
 */
export async function getReports(companyId: string): Promise<Report[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("company_id", companyId)
    .order("generated_at", { ascending: false });

  if (error || !data) return [];
  return data.map(rowToReport);
}

/**
 * Delete a report by ID
 */
export async function deleteReport(reportId: string): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from("reports")
    .delete()
    .eq("report_id", reportId);

  if (error) throw new Error(`Failed to delete report: ${error.message}`);
}

/**
 * Get all reports for companies tracked by an organization.
 * Uses the organization_tracked_companies junction table.
 */
export async function getAllReports(
  organizationId: string,
): Promise<Report[]> {
  const supabase = createAdminClient();

  try {
    // Get company IDs tracked by this org
    const { data: tracked } = await supabase
      .from("organization_tracked_companies")
      .select("company_id")
      .eq("organization_id", organizationId);

    if (!tracked || tracked.length === 0) return [];

    const companyIds = tracked.map((t) => t.company_id);

    // Fetch reports for those companies
    const { data: reportRows, error } = await supabase
      .from("reports")
      .select("*, companies(company_name, website_url)")
      .in("company_id", companyIds)
      .order("generated_at", { ascending: false })
      .limit(50);

    if (error || !reportRows) return [];

    return reportRows.map(
      (r: Record<string, unknown>) =>
        ({
          report_id: r.report_id as string,
          company_id: r.company_id as string,
          generated_at: r.generated_at as string,
          report_data: r.report_data as ReportData,
          trigger: (r.trigger as "manual" | "cron") || "cron",
          companies: r.companies as
            | { company_name: string; website_url: string }
            | undefined,
        }) as Report,
    );
  } catch {
    return [];
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToReport(row: any): Report {
  return {
    report_id: row.report_id,
    company_id: row.company_id,
    generated_at: row.generated_at ?? new Date().toISOString(),
    report_data: row.report_data as ReportData,
    trigger: (row.trigger as "manual" | "cron") || "cron",
  };
}
