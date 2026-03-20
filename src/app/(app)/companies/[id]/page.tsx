"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Play,
  Trash2,
  X,
  MailIcon,
  TrashIcon,
  EyeIcon,
} from "lucide-react";
import {
  getCompanies,
  getReports,
  getSignalDefinitions,
  createSignalDefinition,
  deleteSignalDefinition,
  deleteCompany,
  deleteReport,
  sendReportEmail,
  previewReportEmail,
  type Company,
} from "@/lib/api/client";
import type { SignalDefinition, Report, ReportData, ReportSignal } from "@/lib/types";
import { normalizeReportData } from "@/lib/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRuns } from "@/lib/context/RunsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RunProgressRing } from "@/components/RunProgressRing";
import { ActiveRunModal } from "@/components/ActiveRunModal";

// --- Helpers (reused from reports page) ---

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isNewSignal(detectedAt: string): boolean {
  return new Date(detectedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function renderAiLine(line: string, lineIndex: number) {
  const t = line.trim();
  if (!t) return <br key={`br-${lineIndex}`} />;

  const renderInline = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={part}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );

  if (t.startsWith("###"))
    return (
      <h5 key={`h5-${lineIndex}`} className="mt-3 mb-1 text-sm font-semibold">
        {t.replace(/^###\s*/, "").replace(/\*\*/g, "")}
      </h5>
    );
  if (t.startsWith("##"))
    return (
      <h4 key={`h4-${lineIndex}`} className="mt-3 mb-1 text-sm font-semibold">
        {t.replace(/^##\s*/, "").replace(/\*\*/g, "")}
      </h4>
    );
  if (t.startsWith("#"))
    return (
      <h3 key={`h3-${lineIndex}`} className="mt-4 mb-1 text-base font-semibold">
        {t.replace(/^#\s*/, "").replace(/\*\*/g, "")}
      </h3>
    );
  if (t.startsWith("**") && t.endsWith("**") && !t.slice(2, -2).includes("**"))
    return (
      <h4 key={`hb-${lineIndex}`} className="mt-3 mb-1 text-sm font-semibold">
        {t.slice(2, -2)}
      </h4>
    );
  if (/^[-*]\s/.test(t))
    return (
      <p key={`li-${lineIndex}`} className="my-0.5 pl-4">
        {renderInline("• " + t.replace(/^[-*]\s+/, ""))}
      </p>
    );
  return (
    <p key={`p-${lineIndex}`} className="my-1">
      {renderInline(t)}
    </p>
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// --- Report Detail Card ---

function ReportDetailCard({ report }: { report: Report }) {
  const rd = normalizeReportData(report.report_data);
  const hasAi = !!rd.ai_summary;
  const aiLabel =
    rd.ai_summary_type === "business_intelligence"
      ? "Business Intelligence"
      : "AI Summary";

  return (
    <Card>
      <CardContent className="pt-4">
        <Tabs defaultValue="report">
          <TabsList>
            <TabsTrigger value="report">Report</TabsTrigger>
            {hasAi && <TabsTrigger value="ai">{aiLabel}</TabsTrigger>}
          </TabsList>

          <TabsContent value="report" className="mt-4">
            {rd.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No signals found in this report.
              </p>
            ) : (
              <Accordion>
                {rd.sections.map((section, idx) => (
                  <AccordionItem
                    key={`${section.signal_type}-${section.display_name}-${idx}`}
                    value={`${section.signal_type}-${section.display_name}-${idx}`}
                  >
                    <AccordionTrigger>
                      <span className="flex items-center gap-2">
                        {section.display_name}
                        <Badge variant="secondary" className="ml-1">
                          {section.items.length}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4">
                        {section.items.map((item, itemIdx) => (
                          <div key={`${section.signal_type}-${item.detected_at}-${item.title.slice(0, 20)}`}>
                            <div className="flex items-start gap-2">
                              <p className="flex-1 text-sm font-medium">
                                {item.title}
                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1.5 text-xs text-primary hover:underline"
                                  >
                                    [{item.source}]
                                  </a>
                                )}
                              </p>
                              {isNewSignal(item.detected_at) && (
                                <Badge className="shrink-0 text-xs">New</Badge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.summary}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              via {item.source} ·{" "}
                              {new Date(item.detected_at).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                            </p>
                            {itemIdx < section.items.length - 1 && (
                              <Separator className="mt-4" />
                            )}
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </TabsContent>

          {hasAi && (
            <TabsContent value="ai" className="mt-4">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
                {rd.ai_summary!
                  .split("\n")
                  .map((line, lineIdx) => renderAiLine(line, lineIdx))}
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}

// --- Main Page ---

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const { currentOrg } = useAuth();
  const { activeRuns, handleRunCompany } = useRuns();

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Reports state
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [emailSentId, setEmailSentId] = useState<string | null>(null);
  const [emailErrorId, setEmailErrorId] = useState<string | null>(null);
  const [emailErrorMsg, setEmailErrorMsg] = useState("");
  const [previewErrorId, setPreviewErrorId] = useState<string | null>(null);

  // Signals state
  const [globalSignals, setGlobalSignals] = useState<SignalDefinition[]>([]);
  const [companySignals, setCompanySignals] = useState<SignalDefinition[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [signalFormOpen, setSignalFormOpen] = useState(false);
  const [signalForm, setSignalForm] = useState({ name: "", target_url: "", search_instructions: "" });
  const [signalError, setSignalError] = useState("");

  // Run modal
  const [runModalCompanyId, setRunModalCompanyId] = useState<string | null>(null);

  // Delete company
  const [deleteCompanyOpen, setDeleteCompanyOpen] = useState(false);

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

  // Fetch reports
  useEffect(() => {
    if (!currentOrg || !companyId) return;
    setReportsLoading(true);
    getReports(companyId)
      .then((r) =>
        setReports(
          r.sort(
            (a, b) =>
              new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime(),
          ),
        ),
      )
      .catch(() => setReports([]))
      .finally(() => setReportsLoading(false));
  }, [currentOrg, companyId]);

  // Fetch signals
  useEffect(() => {
    if (!currentOrg || !companyId) return;
    setSignalsLoading(true);
    Promise.all([getSignalDefinitions(), getSignalDefinitions(companyId)])
      .then(([allDefs, companyDefs]) => {
        setGlobalSignals(allDefs.filter((d) => d.scope === "global" && d.enabled));
        setCompanySignals(companyDefs.filter((d) => d.scope === "company"));
      })
      .catch(() => {
        setGlobalSignals([]);
        setCompanySignals([]);
      })
      .finally(() => setSignalsLoading(false));
  }, [currentOrg, companyId]);

  const activeRun = activeRuns.find((r) => r.companyId === companyId && !r.isComplete);
  const isRunning = !!activeRun;
  const isQueued = activeRun?.queued ?? false;

  const onRunCompany = () => {
    if (!company) return;
    handleRunCompany(company);
    setRunModalCompanyId(company.company_id);
  };

  const handleDeleteCompany = async () => {
    if (!company) return;
    try {
      await deleteCompany(company.company_id);
      router.push("/companies");
    } catch {
      console.error("[COMPANY] Failed to delete");
    }
  };

  // Report actions
  const handleDeleteReport = async (reportId: string) => {
    if (deletingId) return;
    setDeletingId(reportId);
    try {
      await deleteReport(reportId);
      setReports((prev) => prev.filter((r) => r.report_id !== reportId));
      if (selectedReportId === reportId) setSelectedReportId(null);
    } catch {
    } finally {
      setDeletingId(null);
      setDeleteDialogId(null);
    }
  };

  const handleSendEmail = async (reportId: string) => {
    if (emailingId) return;
    setEmailingId(reportId);
    setEmailErrorId(null);
    try {
      const result = await sendReportEmail(reportId);
      if (result.success) {
        setEmailSentId(reportId);
        setTimeout(() => setEmailSentId(null), 4000);
      } else {
        setEmailErrorId(reportId);
        setEmailErrorMsg(result.error || "Failed to send email");
        setTimeout(() => setEmailErrorId(null), 4000);
      }
    } catch (error) {
      setEmailErrorId(reportId);
      setEmailErrorMsg(error instanceof Error ? error.message : "Failed to send email");
      setTimeout(() => setEmailErrorId(null), 4000);
    } finally {
      setEmailingId(null);
    }
  };

  const handlePreview = async (reportId: string) => {
    setPreviewErrorId(null);
    try {
      const html = await previewReportEmail(reportId);
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    } catch {
      setPreviewErrorId(reportId);
      setTimeout(() => setPreviewErrorId(null), 4000);
    }
  };

  const toggleReport = (reportId: string) =>
    setSelectedReportId((prev) => (prev === reportId ? null : reportId));

  // Signal actions
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
        scope: "company",
        company_id: companyId,
      });
      setCompanySignals((prev) => [...prev, created]);
      setSignalForm({ name: "", target_url: "", search_instructions: "" });
      setSignalFormOpen(false);
    } catch {
      setSignalError("Failed to create signal");
    }
  };

  const handleDeleteSignal = async (id: string) => {
    await deleteSignalDefinition(id);
    setCompanySignals((prev) => prev.filter((s) => s.id !== id));
  };

  const selectedReport = selectedReportId
    ? reports.find((r) => r.report_id === selectedReportId) ?? null
    : null;

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
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{company!.company_name}</h1>
            {activeRun && !isQueued && activeRun.agents.length > 0 && (
              <RunProgressRing run={activeRun} onClick={() => setRunModalCompanyId(companyId)} />
            )}
            {activeRun && !isQueued && activeRun.agents.length === 0 && (
              <Badge variant="default" className="text-[10px] cursor-pointer" onClick={() => setRunModalCompanyId(companyId)}>
                Starting
              </Badge>
            )}
            {isQueued && (
              <Badge variant="outline" className="text-[10px] cursor-pointer" onClick={() => setRunModalCompanyId(companyId)}>
                Queued
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {[company!.industry, company!.domain, company!.founding_year ? `Founded ${company!.founding_year}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isRunning ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRunModalCompanyId(companyId)}
            >
              {isQueued ? "Queued" : "Running"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onRunCompany}>
              <Play className="h-3.5 w-3.5" />
              Run Agents
            </Button>
          )}

          <AlertDialog open={deleteCompanyOpen} onOpenChange={setDeleteCompanyOpen}>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setDeleteCompanyOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">Delete {company!.company_name}</span>
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Company</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove <strong>{company!.company_name}</strong> and all its
                  reports and signals. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDeleteCompany}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
        </TabsList>

        {/* Reports Tab */}
        <TabsContent value="reports" className="mt-4">
          {reportsLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-16 text-center">
              <p className="text-sm font-medium">No reports yet</p>
              <p className="text-xs text-muted-foreground">
                Run agents to generate your first report.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Signals</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reports.map((report) => {
                      const rd = normalizeReportData(report.report_data);
                      const totalSignals = rd.sections.reduce(
                        (s, sec) => s + sec.items.length,
                        0,
                      );
                      const isSelected = selectedReportId === report.report_id;

                      return (
                        <TableRow
                          key={report.report_id}
                          className={`cursor-pointer ${isSelected ? "bg-muted/80" : ""}`}
                          onClick={() => toggleReport(report.report_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleReport(report.report_id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={isSelected}
                        >
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(report.generated_at)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{totalSignals}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {report.trigger === "cron" ? "Scheduled" : "Manual"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Preview email"
                                  disabled={previewErrorId === report.report_id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePreview(report.report_id);
                                  }}
                                >
                                  <EyeIcon className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="Send email"
                                  disabled={
                                    emailingId === report.report_id ||
                                    emailSentId === report.report_id ||
                                    emailErrorId === report.report_id
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendEmail(report.report_id);
                                  }}
                                >
                                  {emailSentId === report.report_id ? (
                                    <span className="text-xs text-green-600">Sent</span>
                                  ) : emailErrorId === report.report_id ? (
                                    <span className="text-xs text-red-600">Error</span>
                                  ) : (
                                    <MailIcon className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteDialogId(report.report_id);
                                  }}
                                >
                                  <TrashIcon className="h-4 w-4" />
                                </Button>
                              </div>
                              {emailErrorId === report.report_id && (
                                <span className="text-xs text-red-600">{emailErrorMsg}</span>
                              )}
                              {previewErrorId === report.report_id && (
                                <span className="text-xs text-red-600">Preview failed</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>

              <Sheet
                open={!!selectedReportId}
                onOpenChange={(open) => {
                  if (!open) setSelectedReportId(null);
                }}
              >
                <SheetContent side="right" className="sm:max-w-[70vw] overflow-y-auto">
                  {selectedReport && (
                    <>
                      <SheetHeader>
                        <SheetTitle>
                          {formatDate(selectedReport.generated_at)}
                        </SheetTitle>
                        <SheetDescription>
                          <Badge variant="outline">
                            {selectedReport.trigger === "cron" ? "Scheduled" : "Manual"}
                          </Badge>
                        </SheetDescription>
                      </SheetHeader>
                      <div className="px-4 pb-4">
                        <ReportDetailCard report={selectedReport} />
                      </div>
                    </>
                  )}
                </SheetContent>
              </Sheet>
            </div>
          )}

          <AlertDialog
            open={!!deleteDialogId}
            onOpenChange={(open) => {
              if (!open) setDeleteDialogId(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Report?</AlertDialogTitle>
                <AlertDialogDescription>
                  This report will be permanently deleted. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={!!deletingId}
                  onClick={() => deleteDialogId && handleDeleteReport(deleteDialogId)}
                >
                  {deletingId ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
              {/* Global Signals */}
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">Global Signals</p>
                  <p className="text-xs text-muted-foreground">
                    Organization-wide signals that run for all companies
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  {globalSignals.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No global signals configured.
                    </p>
                  ) : (
                    globalSignals.map((sig) => (
                      <div
                        key={sig.id}
                        className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{sig.display_name}</div>
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
                  {companySignals.length === 0 && !signalFormOpen && (
                    <p className="text-sm text-muted-foreground py-4">
                      No custom signals. Add one to track specific topics.
                    </p>
                  )}
                  {companySignals.map((sig) => (
                    <div
                      key={sig.id}
                      className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{sig.display_name}</div>
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
                        setSignalForm({ name: "", target_url: "", search_instructions: "" });
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
                              setSignalForm((f) => ({ ...f, name: e.target.value }))
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
                              setSignalForm((f) => ({ ...f, target_url: e.target.value }))
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

      <ActiveRunModal
        companyId={runModalCompanyId}
        onOpenChange={(open) => {
          if (!open) setRunModalCompanyId(null);
        }}
      />
    </div>
  );
}
