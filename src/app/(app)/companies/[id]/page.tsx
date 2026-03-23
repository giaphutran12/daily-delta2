"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  X,
  Lock,
  Clock,
  ExternalLink,
} from "lucide-react";
import {
  getCompanies,
  getSignals,
  getSignalDefinitions,
  createSignalDefinition,
  deleteSignalDefinition,
  untrackCompany,
  type TrackedCompany,
} from "@/lib/api/client";
import type { SignalDefinition, Signal } from "@/lib/types";
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
    } catch {
      console.error("[COMPANY] Failed to untrack");
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
    await deleteSignalDefinition(id);
    setSignalDefs((prev) => prev.filter((s) => s.id !== id));
  };

  const timeline = groupSignalsByDay(timelineSignals);

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
          {timelineLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-16 text-center">
              <p className="text-sm font-medium">No signals yet</p>
              <p className="text-xs text-muted-foreground">
                Signals will appear here once the platform processes this
                company.
              </p>
            </div>
          ) : (
            <div className="relative">
              {timeline.map(({ day, groups }, dayIdx) => (
                <div key={day} className="relative pb-8 last:pb-0">
                  {/* Vertical line */}
                  {dayIdx < timeline.length - 1 && (
                    <div className="absolute left-[7px] top-5 bottom-0 w-px bg-muted-foreground/20" />
                  )}

                  {/* Day header with dot */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="relative z-10 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-primary bg-background" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {day}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                      {groups.reduce((sum, [, sigs]) => sum + sigs.length, 0)}
                    </Badge>
                  </div>

                  {/* Signal groups for this day */}
                  <div className="ml-[7px] border-l border-muted-foreground/20 pl-6 flex flex-col gap-4">
                    {groups.map(([signalType, signals]) => (
                      <div key={signalType}>
                        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                          {signalTypeLabel(signalType)}
                        </h4>
                        <div className="flex flex-col gap-3">
                          {signals.map((signal) => (
                            <div
                              key={signal.signal_id}
                              className="rounded-lg border bg-card p-3"
                            >
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
