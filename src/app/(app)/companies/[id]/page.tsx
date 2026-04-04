"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Trash2,
  X,
  Lock,
  Clock,
  ExternalLink,
  Loader2,
  Play,
} from "lucide-react";
import {
  addCompetitor,
  triggerManualPipelineRun,
  getComparisonSignals,
  getCompanies,
  getCompetitors,
  getSignals,
  getSignalDefinitions,
  createSignalDefinition,
  deleteSignalDefinition,
  removeCompetitor,
  untrackCompany,
  type TrackedCompany,
} from "@/lib/api/client";
import type { CompetitorLink, SignalDefinition, Signal } from "@/lib/types";
import {
  isExactEnoughCompanyMatch,
  looksLikeWebsiteQuery,
} from "@/lib/utils/company-search";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CompanyChat } from "@/components/CompanyChat";
import {
  EntitySearchCombobox,
  type EntitySearchOption,
} from "@/components/entity-search-combobox";

// --- Helpers ---

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  product_launch: "Product Launches",
  general_news: "General News",
  hiring_trend: "Hiring Trends",
  pricing_update: "Pricing Updates",
  founder_contact: "Founder Contacts",
  leading_indicator: "Leading Indicators",
  competitive_landscape: "Competitive Landscape",
  fundraising_signal: "Fundraising Signals",
};

function signalTypeLabel(type: string): string {
  return (
    SIGNAL_TYPE_LABELS[type] ??
    type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ")
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function groupSignalsByDay(signals: Signal[]) {
  const groupedByDay = new Map<string, Signal[]>();
  for (const signal of signals) {
    const day = signal.detected_at
      ? new Date(signal.detected_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Date Unknown";
    if (!groupedByDay.has(day)) groupedByDay.set(day, []);
    groupedByDay.get(day)!.push(signal);
  }

  // Sort days newest first, "Date Unknown" goes to the bottom
  const sortedDays = [...groupedByDay.entries()].sort((a, b) => {
    if (a[0] === "Date Unknown") return 1;
    if (b[0] === "Date Unknown") return -1;
    return new Date(b[0]).getTime() - new Date(a[0]).getTime();
  });

  // Within each day, group by signal_type
  return sortedDays.map(([day, daySignals]) => {
    const byType = new Map<string, Signal[]>();
    for (const s of daySignals) {
      if (!byType.has(s.signal_type)) byType.set(s.signal_type, []);
      byType.get(s.signal_type)!.push(s);
    }
    return { day, groups: [...byType.entries()] };
  });
}

function getIndustryColor(industry: string | null | undefined): string {
  const palette = [
    "bg-blue-100 text-blue-800 border-blue-200",
    "bg-emerald-100 text-emerald-800 border-emerald-200",
    "bg-amber-100 text-amber-800 border-amber-200",
    "bg-rose-100 text-rose-800 border-rose-200",
    "bg-violet-100 text-violet-800 border-violet-200",
    "bg-cyan-100 text-cyan-800 border-cyan-200",
  ];

  const seed = (industry ?? "unknown")
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[seed % palette.length];
}

function sortSignalsByPriority(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    const scoreDelta = (b.priority_score ?? 0) - (a.priority_score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return (
      new Date(b.detected_at ?? b.created_at).getTime() -
      new Date(a.detected_at ?? a.created_at).getTime()
    );
  });
}

function groupTimelineSignals(signals: Signal[]) {
  const groupedByDay = new Map<string, Signal[]>();
  for (const signal of signals) {
    const day = signal.detected_at
      ? new Date(signal.detected_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Date Unknown";
    if (!groupedByDay.has(day)) groupedByDay.set(day, []);
    groupedByDay.get(day)!.push(signal);
  }

  return [...groupedByDay.entries()]
    .sort((a, b) => {
      if (a[0] === "Date Unknown") return 1;
      if (b[0] === "Date Unknown") return -1;
      return new Date(b[0]).getTime() - new Date(a[0]).getTime();
    })
    .map(([day, daySignals]) => ({
      day,
      signals: sortSignalsByPriority(daySignals),
    }));
}

// --- Main Page ---

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const { currentOrg } = useAuth();

  const [company, setCompany] = useState<TrackedCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Timeline signals state
  const [timelineSignals, setTimelineSignals] = useState<Signal[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [comparisonSignals, setComparisonSignals] = useState<Signal[]>([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorLink[]>([]);
  const [suggestions, setSuggestions] = useState<TrackedCompany[]>([]);
  const [competitorsLoading, setCompetitorsLoading] = useState(true);
  const [competitorQuery, setCompetitorQuery] = useState("");
  const [competitorSaving, setCompetitorSaving] = useState(false);
  const [competitorSearchLoading, setCompetitorSearchLoading] = useState(false);
  const [competitorMessage, setCompetitorMessage] = useState<string | null>(null);
  const [suggestAddCompetitor, setSuggestAddCompetitor] = useState<{
    name: string;
    suggestedUrl: string;
    customUrl: string;
  } | null>(null);
  const [addingNewCompetitor, setAddingNewCompetitor] = useState(false);
  const competitorSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const competitorSearchReadyRef = useRef(false);

  // Signal definitions state
  const [signalDefs, setSignalDefs] = useState<SignalDefinition[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [signalFormOpen, setSignalFormOpen] = useState(false);
  const [signalForm, setSignalForm] = useState({
    name: "",
    target_url: "",
    search_instructions: "",
  });
  const [signalError, setSignalError] = useState("");

  // Untrack company
  const [untrackOpen, setUntrackOpen] = useState(false);
  const [manualRunLoading, setManualRunLoading] = useState(false);

  // Fetch company
  useEffect(() => {
    if (!currentOrg) return;
    setLoading(true);
    getCompanies()
      .then(({ companies }) => {
        const found = companies.find((c) => c.company_id === companyId);
        if (found) {
          setCompany(found);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [currentOrg, companyId]);

  useEffect(() => {
    if (!currentOrg || !companyId) return;
    competitorSearchReadyRef.current = false;
    setCompetitorsLoading(true);
    getCompetitors(companyId)
      .then((result) => {
        setCompetitors(result.competitors);
        setSuggestions(result.suggestions as TrackedCompany[]);
      })
      .catch((err) => {
        setCompetitors([]);
        setSuggestions([]);
        toast.error(err instanceof Error ? err.message : "Failed to load competitors");
      })
      .finally(() => {
        competitorSearchReadyRef.current = true;
        setCompetitorsLoading(false);
      });
  }, [currentOrg, companyId]);

  useEffect(() => {
    if (!currentOrg || !companyId || !competitorSearchReadyRef.current) return;
    clearTimeout(competitorSearchDebounceRef.current);
    setCompetitorSearchLoading(true);

    competitorSearchDebounceRef.current = setTimeout(() => {
      getCompetitors(companyId, competitorQuery.trim() || undefined)
        .then((result) => setSuggestions(result.suggestions as TrackedCompany[]))
        .catch(() => setSuggestions([]))
        .finally(() => setCompetitorSearchLoading(false));
    }, 250);

    return () => clearTimeout(competitorSearchDebounceRef.current);
  }, [currentOrg, companyId, competitorQuery]);

  useEffect(() => {
    if (!compareMode || competitors.length === 0) {
      setComparisonSignals([]);
      return;
    }

    setComparisonLoading(true);
    getComparisonSignals([companyId, ...competitors.map((c) => c.competitor_company_id)])
      .then(({ signals }) => setComparisonSignals(signals))
      .catch(() => setComparisonSignals([]))
      .finally(() => setComparisonLoading(false));
  }, [compareMode, competitors, companyId]);

  // Fetch timeline signals
  useEffect(() => {
    if (!currentOrg || !companyId) return;
    setTimelineLoading(true);
    getSignals(companyId)
      .then(({ signals }) => setTimelineSignals(signals))
      .catch(() => setTimelineSignals([]))
      .finally(() => setTimelineLoading(false));
  }, [currentOrg, companyId]);

  // Fetch signal definitions
  useEffect(() => {
    if (!currentOrg || !companyId) return;
    setSignalsLoading(true);
    getSignalDefinitions(companyId)
      .then((defs) => setSignalDefs(defs))
      .catch(() => setSignalDefs([]))
      .finally(() => setSignalsLoading(false));
  }, [currentOrg, companyId]);

  const defaultSignals = signalDefs.filter((s) => s.is_default);
  const customSignals = signalDefs.filter((s) => !s.is_default);

  const handleUntrackCompany = async () => {
    if (!company) return;
    try {
      await untrackCompany(company.company_id);
      router.push("/companies");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to untrack company");
    }
  };

  // Signal definition actions
  const handleCreateSignal = async () => {
    if (!signalForm.name.trim()) return;
    setSignalError("");
    try {
      const created = await createSignalDefinition({
        name: signalForm.name,
        signal_type: slugify(signalForm.name),
        display_name: signalForm.name,
        target_url: signalForm.target_url,
        search_instructions: signalForm.search_instructions,
        company_id: companyId,
      });
      setSignalDefs((prev) => [...prev, created]);
      setSignalForm({ name: "", target_url: "", search_instructions: "" });
      setSignalFormOpen(false);
    } catch {
      setSignalError("Failed to create signal");
    }
  };

  const handleDeleteSignal = async (id: string) => {
    try {
      await deleteSignalDefinition(id);
      setSignalDefs((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete signal");
    }
  };

  const timeline = groupTimelineSignals(timelineSignals);
  const comparisonTimeline = groupTimelineSignals(comparisonSignals);

  const handleAddCompetitor = async (
    payload:
      | { competitor_company_id: string }
      | { website_url: string; page_title?: string },
  ) => {
    setCompetitorSaving(true);
    setCompetitorMessage(null);
    setSuggestAddCompetitor(null);
    try {
      const result = await addCompetitor(companyId, payload);
      const next = await getCompetitors(companyId);
      setCompetitors(next.competitors);
      setSuggestions(next.suggestions as TrackedCompany[]);
      setCompareMode(true);
      setCompetitorQuery("");
      setCompetitorMessage(
        result.refreshQueued
          ? `${result.competitor.company_name} was added. Fresh signals are being prepared now.`
          : `${result.competitor.company_name} was added to the competitor timeline.`,
      );
    } catch (error) {
      setCompetitorMessage(
        error instanceof Error ? error.message : "Failed to add competitor.",
      );
    } finally {
      setCompetitorSaving(false);
    }
  };

  const handleRemoveCompetitor = async (competitorCompanyId: string) => {
    try {
      await removeCompetitor(companyId, competitorCompanyId);
      const next = await getCompetitors(companyId);
      setCompetitors(next.competitors);
      setSuggestions(next.suggestions as TrackedCompany[]);
      if (next.competitors.length === 0) {
        setCompareMode(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove competitor");
    }
  };

  const competitorOptions: EntitySearchOption<TrackedCompany>[] = suggestions.map(
    (company) => ({
      id: company.company_id,
      label: company.company_name,
      subtitle: `${company.domain || company.website_url || "(unknown domain)"}${company.industry ? ` · ${company.industry}` : ""}`,
      value: company,
    }),
  );

  const handleSubmitCompetitorQuery = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const topSuggestion = suggestions[0];
    if (topSuggestion && isExactEnoughCompanyMatch(topSuggestion, trimmed)) {
      await handleAddCompetitor({ competitor_company_id: topSuggestion.company_id });
      return;
    }

    if (looksLikeWebsiteQuery(trimmed)) {
      await handleAddCompetitor({ website_url: trimmed });
      return;
    }

    // No match — offer to add as a new company
    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
    const suggestedUrl = `https://${slug}.com`;
    setSuggestAddCompetitor({ name: trimmed, suggestedUrl, customUrl: "" });
    setCompetitorMessage(null);
  };

  const handleConfirmAddNewCompetitor = async () => {
    if (!suggestAddCompetitor) return;
    const url = suggestAddCompetitor.customUrl.trim() || suggestAddCompetitor.suggestedUrl;
    setAddingNewCompetitor(true);
    try {
      await handleAddCompetitor({ website_url: url, page_title: suggestAddCompetitor.name });
      setSuggestAddCompetitor(null);
      setCompetitorMessage(
        `${suggestAddCompetitor.name} added. We're gathering intel now — first signals will appear shortly.`,
      );
    } catch {
      // handleAddCompetitor already sets competitorMessage on error
    } finally {
      setAddingNewCompetitor(false);
    }
  };

  const handleManualRun = async () => {
    if (!company) return;

    setManualRunLoading(true);
    try {
      await triggerManualPipelineRun({ companyIds: [company.company_id] });
      toast.success(
        `Queued a manual run for ${company.company_name}. The report email will go to you by default.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to queue manual run",
      );
    } finally {
      setManualRunLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16">
        <p className="text-sm text-muted-foreground">Company not found.</p>
        <Button variant="outline" onClick={() => router.push("/companies")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Companies
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => router.push("/companies")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Companies
          </button>
          <h1 className="text-xl font-semibold">{company!.company_name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {[
                company!.industry,
                company!.domain,
                company!.founding_year
                  ? `Founded ${company!.founding_year}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {company!.last_agent_run && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <span className="flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  Updated {formatRelativeTime(company!.last_agent_run)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleManualRun()}
            disabled={manualRunLoading}
          >
            {manualRunLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">
              {manualRunLoading ? "Queueing..." : "Run now"}
            </span>
          </Button>
          <AlertDialog open={untrackOpen} onOpenChange={setUntrackOpen}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setUntrackOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="ml-1">Untrack</span>
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Untrack Company</AlertDialogTitle>
                <AlertDialogDescription>
                  This will stop tracking{" "}
                  <strong>{company!.company_name}</strong> and remove it from
                  your tracked companies. Existing reports will be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleUntrackCompany}
                >
                  Untrack
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
        </TabsList>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="mt-4">
          <div className="mb-4 rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Competitor Timeline</p>
                <p className="text-xs text-muted-foreground">
                  Compare {company!.company_name} against competitors you choose.
                </p>
              </div>
              <Button
                size="sm"
                variant={compareMode ? "default" : "outline"}
                disabled={competitors.length === 0}
                onClick={() => setCompareMode((prev) => !prev)}
              >
                {compareMode ? "Back to company timeline" : "View competitors timeline"}
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary">{company!.company_name}</Badge>
              {competitors.map((entry) => (
                <div
                  key={entry.competitor_company_id}
                  className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${getIndustryColor(
                    entry.competitor.industry,
                  )}`}
                >
                  <span>{entry.competitor.company_name}</span>
                  <button
                    type="button"
                    onClick={() => void handleRemoveCompetitor(entry.competitor_company_id)}
                    className="rounded-full opacity-70 transition hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <EntitySearchCombobox
                query={competitorQuery}
                onQueryChange={setCompetitorQuery}
                options={competitorOptions}
                loading={competitorSearchLoading}
                disabled={competitorSaving}
                placeholder="Search competitor by company name or website"
                emptyMessage={
                  competitorQuery.trim()
                    ? `No companies match "${competitorQuery.trim()}".`
                    : "No competitor suggestions yet."
                }
                submitLabel={competitorSaving ? "Adding..." : "Add competitor"}
                onSelectOption={(option) =>
                  handleAddCompetitor({
                    competitor_company_id: option.value.company_id,
                  })
                }
                onSubmitQuery={handleSubmitCompetitorQuery}
              />
            </div>

            {suggestAddCompetitor && (
              <div className="mt-3 rounded-lg border bg-muted/30 p-4">
                <p className="text-sm font-medium">
                  &ldquo;{suggestAddCompetitor.name}&rdquo; isn&apos;t tracked yet. Add it?
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={suggestAddCompetitor.suggestedUrl}
                    value={suggestAddCompetitor.customUrl}
                    onChange={(e) =>
                      setSuggestAddCompetitor((prev) =>
                        prev ? { ...prev, customUrl: e.target.value } : prev,
                      )
                    }
                    className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button
                    size="sm"
                    disabled={addingNewCompetitor}
                    onClick={handleConfirmAddNewCompetitor}
                  >
                    {addingNewCompetitor ? "Adding..." : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSuggestAddCompetitor(null)}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Enter the company website, or press Add to use {suggestAddCompetitor.suggestedUrl}
                </p>
              </div>
            )}

            {competitorMessage && !suggestAddCompetitor && (
              <p className="mt-2 text-xs text-muted-foreground">{competitorMessage}</p>
            )}

            {!competitorsLoading && !suggestAddCompetitor ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Type a company name or website URL. If it&apos;s not tracked yet, we&apos;ll offer to add it.
              </p>
            ) : null}
          </div>

          {(compareMode ? comparisonLoading : timelineLoading) ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : compareMode && competitors.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-16 text-center">
              <p className="text-sm font-medium">No competitors yet</p>
              <p className="text-xs text-muted-foreground">
                Add a competitor above to compare what they are doing against {company!.company_name}.
              </p>
            </div>
          ) : (compareMode ? comparisonTimeline : timeline).length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-16 text-center">
              <p className="text-sm font-medium">No signals yet</p>
              <p className="text-xs text-muted-foreground">
                {compareMode
                  ? "Signals will appear here once the selected competitors have fresh data."
                  : "Signals will appear here once the platform processes this company."}
              </p>
            </div>
          ) : (
            <div className="relative">
              {(compareMode ? comparisonTimeline : timeline).map(
                ({ day, signals }, dayIdx, allDays) => (
                <div key={day} className="relative pb-8 last:pb-0">
                  {/* Vertical line */}
                  {dayIdx < allDays.length - 1 && (
                    <div className="absolute left-[7px] top-5 bottom-0 w-px bg-muted-foreground/20" />
                  )}

                  {/* Day header with dot */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="relative z-10 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-primary bg-background" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {day}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {signals.length}
                    </Badge>
                  </div>

                  {/* Signals for this day */}
                  <div className="ml-[7px] border-l border-muted-foreground/20 pl-6 flex flex-col gap-4">
                    {signals.map((signal) => (
                      <div
                        key={signal.signal_id}
                        className="rounded-lg border bg-card p-3"
                      >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={signal.company ? getIndustryColor(signal.company.industry) : ""}
                          >
                            {signal.company?.company_name ?? company!.company_name}
                          </Badge>
                          <Badge variant="secondary">
                            {signalTypeLabel(signal.signal_type)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              signal.priority_tier === "high"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : signal.priority_tier === "medium"
                                  ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : "border-slate-200 bg-slate-50 text-slate-700"
                            }
                          >
                            {signal.priority_tier ?? "low"} signal
                          </Badge>
                        </div>
                        <p className="text-sm font-medium leading-snug">
                          {signal.url ? (
                            <a
                              href={signal.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline inline-flex items-center gap-1"
                            >
                              {signal.title}
                              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                            </a>
                          ) : (
                            signal.title
                          )}
                        </p>
                        {signal.content && (
                          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                            {signal.content}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground/70">
                            via {signal.source}
                            {signal.detected_at && (
                              <>
                                {" "}&middot;{" "}
                                {new Date(signal.detected_at).toLocaleDateString(
                                  "en-US",
                                  {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric",
                                  },
                                )}
                              </>
                            )}
                          </p>
                          {signal.created_at && (
                            <p className="text-xs text-muted-foreground/50 shrink-0">
                              Discovered {formatRelativeTime(signal.created_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Signals Tab */}
        <TabsContent value="signals" className="mt-4">
          {signalsLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Default Signals (read-only) */}
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">Default Signals</p>
                  <p className="text-xs text-muted-foreground">
                    Platform-provided signals that run for this company
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {defaultSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No default signals configured.
                    </p>
                  ) : (
                    defaultSignals.map((sig) => (
                      <div
                        key={sig.id}
                        className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            {sig.display_name}
                            <Lock className="h-3 w-3 text-muted-foreground" />
                          </div>
                          {sig.target_url && (
                            <div className="text-xs text-muted-foreground truncate">
                              {sig.target_url}
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Custom Signals */}
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">Custom Signals</p>
                  <p className="text-xs text-muted-foreground">
                    Signals specific to this company
                  </p>
                </div>

                {signalError && (
                  <p className="text-xs text-destructive">{signalError}</p>
                )}

                <div className="flex flex-col gap-1.5">
                  {customSignals.length === 0 && !signalFormOpen && (
                    <p className="text-sm text-muted-foreground py-4">
                      No custom signals. Add one to track specific topics.
                    </p>
                  )}
                  {customSignals.map((sig) => (
                    <div
                      key={sig.id}
                      className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {sig.display_name}
                        </div>
                        {sig.target_url && (
                          <div className="text-xs text-muted-foreground truncate">
                            {sig.target_url}
                          </div>
                        )}
                        {sig.search_instructions && (
                          <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {sig.search_instructions}
                          </div>
                        )}
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleDeleteSignal(sig.id)}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  ))}

                  <Dialog
                    open={signalFormOpen}
                    onOpenChange={(open) => {
                      setSignalFormOpen(open);
                      if (!open)
                        setSignalForm({
                          name: "",
                          target_url: "",
                          search_instructions: "",
                        });
                    }}
                  >
                    <DialogTrigger
                      render={
                        <button className="w-full rounded-md border border-dashed border-muted-foreground/40 py-2 text-sm text-muted-foreground hover:border-muted-foreground/70 hover:text-foreground transition-colors" />
                      }
                    >
                      + Add Signal
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-sm">
                      <DialogHeader>
                        <DialogTitle>Add Custom Signal</DialogTitle>
                      </DialogHeader>
                      <div className="flex flex-col gap-3 py-2">
                        <div className="flex flex-col gap-1.5">
                          <Label>Signal name</Label>
                          <Input
                            placeholder="e.g. Blog Scanner"
                            value={signalForm.name}
                            onChange={(e) =>
                              setSignalForm((f) => ({
                                ...f,
                                name: e.target.value,
                              }))
                            }
                            autoFocus
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Target URL</Label>
                          <Input
                            placeholder="e.g. {website_url}/blog or https://example.com/blog"
                            value={signalForm.target_url}
                            onChange={(e) =>
                              setSignalForm((f) => ({
                                ...f,
                                target_url: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>Search instructions</Label>
                          <Textarea
                            placeholder="What to look for..."
                            value={signalForm.search_instructions}
                            onChange={(e) =>
                              setSignalForm((f) => ({
                                ...f,
                                search_instructions: e.target.value,
                              }))
                            }
                            rows={3}
                            className="resize-none"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setSignalFormOpen(false);
                            setSignalForm({
                              name: "",
                              target_url: "",
                              search_instructions: "",
                            });
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          disabled={!signalForm.name.trim()}
                          onClick={handleCreateSignal}
                        >
                          Add Signal
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CompanyChat companyId={companyId} companyName={company!.company_name} />
    </div>
  );
}
