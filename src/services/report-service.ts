import { createAdminClient } from "@/lib/supabase/admin";
import {
  Report,
  ReportData,
  ReportSignal,
  ReportSection,
  Company,
  DigestCompany,
  SignalFinding,
  SignalDefinition,
} from "@/lib/types";

export interface DigestCompanyOutcomeInput {
  companyId: string;
  reportId?: string | null;
  status: "completed" | "failed";
  signalCount: number;
  error?: string | null;
}

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

export function countReportSignals(reportData: ReportData): number {
  return reportData.sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
}

export async function getRecentReportForCompany(
  companyId: string,
  maxAgeHours: number,
): Promise<{ report: Report; signalCount: number } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .eq("company_id", companyId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const report = rowToReport(data);
  const ageMs = Date.now() - new Date(report.generated_at).getTime();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return null;
  }

  return {
    report,
    signalCount: countReportSignals(report.report_data),
  };
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

export async function getDigestCompaniesForReports(
  reportIds: string[],
): Promise<DigestCompany[]> {
  if (reportIds.length === 0) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("reports")
    .select("*, companies(*)")
    .in("report_id", reportIds)
    .order("generated_at", { ascending: true });

  if (error || !data) return [];

  const reportOrder = new Map(reportIds.map((reportId, index) => [reportId, index]));

  return (data as Array<Record<string, unknown>>)
    .sort(
      (a, b) =>
        (reportOrder.get(a.report_id as string) ?? Number.MAX_SAFE_INTEGER) -
        (reportOrder.get(b.report_id as string) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((row) => {
      const report = rowToReport(row);
      const company = row.companies as Company;

      const findings: SignalFinding[] = report.report_data.sections.flatMap(
        (section) =>
          section.items.map((item) => ({
            signal_type: section.signal_type,
            title: item.title,
            summary: item.summary,
            source: item.source,
            url: item.url,
            detected_at: item.detected_at,
          })),
      );

      return {
        company,
        findings,
        status: "changed" as const,
        reportId: report.report_id,
      };
    });
}

export async function getDigestCompaniesForOutcomes(
  outcomes: DigestCompanyOutcomeInput[],
): Promise<DigestCompany[]> {
  if (outcomes.length === 0) return [];

  const companyIds = [...new Set(outcomes.map((outcome) => outcome.companyId))];
  const reportIds = [
    ...new Set(
      outcomes
        .map((outcome) => outcome.reportId)
        .filter((reportId): reportId is string => !!reportId),
    ),
  ];

  const supabase = createAdminClient();
  const [companyResponse, reportResponse] = await Promise.all([
    supabase.from("companies").select("*").in("company_id", companyIds),
    reportIds.length > 0
      ? supabase.from("reports").select("*, companies(*)").in("report_id", reportIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyResponse.error) {
    throw new Error(`Failed to load digest companies: ${companyResponse.error.message}`);
  }

  if (reportResponse.error) {
    throw new Error(`Failed to load digest reports: ${reportResponse.error.message}`);
  }

  const companyById = new Map(
    ((companyResponse.data ?? []) as Company[]).map((company) => [
      company.company_id,
      company,
    ]),
  );

  const reportById = new Map(
    ((reportResponse.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const report = rowToReport(row);
      return [report.report_id, report] as const;
    }),
  );

  return outcomes
    .flatMap((outcome) => {
      const company = companyById.get(outcome.companyId);
      if (!company) return [];

      const report =
        outcome.reportId && reportById.has(outcome.reportId)
          ? reportById.get(outcome.reportId)!
          : null;

      const findings: SignalFinding[] = report
        ? report.report_data.sections.flatMap((section) =>
            section.items.map((item) => ({
              signal_type: section.signal_type,
              title: item.title,
              summary: item.summary,
              source: item.source,
              url: item.url,
              detected_at: item.detected_at,
            })),
          )
        : [];

      return [
        {
          company,
          findings,
          status:
            outcome.status === "failed"
              ? ("failed" as const)
              : outcome.reportId && outcome.signalCount > 0
                ? ("changed" as const)
                : ("no_change" as const),
          reportId: outcome.reportId ?? undefined,
          error: outcome.error ?? undefined,
        },
      ];
    })
    .sort((a, b) => a.company.company_name.localeCompare(b.company.company_name));
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
