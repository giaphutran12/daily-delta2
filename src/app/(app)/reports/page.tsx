"use client";

import { useState, useEffect } from "react";
import {
  getReports,
  getCompanies,
  deleteReport,
  sendReportEmail,
  previewReportEmail,
} from "@/lib/api/client";
import {
  type Report,
  type Company,
  type ReportData,
  type ReportSignal,
} from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MailIcon, TrashIcon, EyeIcon } from "lucide-react";

function getAllSignalsSorted(
  rd: ReportData,
): Array<ReportSignal & { category: string }> {
  const normalized = (rd);
  const all: Array<ReportSignal & { category: string }> = [];
  for (const section of normalized.sections) {
    for (const item of section.items) {
      all.push({ ...item, category: section.display_name });
    }
  }
  return all.sort(
    (a, b) =>
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime(),
  );
}

function isNewSignal(detectedAt: string): boolean {
  return new Date(detectedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

function ReportDetailCard({
  report,
  companyName,
}: {
  report: Report;
  companyName: string;
}) {
  const rd = (report.report_data);
  const hasAi = !!rd.ai_summary;
  const aiLabel =
    rd.ai_summary_type === "business_intelligence"
      ? "Business Intelligence"
      : "AI Summary";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{companyName}</CardTitle>
            <CardDescription className="mt-1">
              {rd.company_overview}
            </CardDescription>
          </div>
          <Badge variant="outline">
            {report.trigger === "cron" ? "Scheduled" : "Manual"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
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
              <Accordion defaultValue={rd.sections.map((section, idx) => `${section.signal_type}-${section.display_name}-${idx}`)}>
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
                          <div
                            key={`${section.signal_type}-${item.detected_at}-${item.title.slice(0, 20)}`}
                          >
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
                              {new Date(item.detected_at).toLocaleDateString(
                                "en-US",
                                { month: "short", day: "numeric", year: "numeric" },
                              )}
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

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("all");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [emailSentId, setEmailSentId] = useState<string | null>(null);
  const [emailErrorId, setEmailErrorId] = useState<string | null>(null);
  const [emailErrorMsg, setEmailErrorMsg] = useState<string>("");
  const [previewErrorId, setPreviewErrorId] = useState<string | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getReports(), getCompanies()])
      .then(([r, c]) => {
        setReports(
          r.sort(
            (a, b) =>
              new Date(b.generated_at).getTime() -
              new Date(a.generated_at).getTime(),
          ),
        );
        setCompanies(c.companies);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Failed to load reports";
        setLoadError(msg);
        toast.error(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  const filteredReports =
    selectedCompanyId === "all"
      ? reports
      : reports.filter((r) => r.company_id === selectedCompanyId);

  const selectedReport = selectedReportId
    ? reports.find((r) => r.report_id === selectedReportId) ?? null
    : null;

  const getCompanyName = (companyId: string) =>
    companies.find((c) => c.company_id === companyId)?.company_name ?? "Unknown";

  const handleDelete = async (reportId: string) => {
    if (deletingId) return;
    setDeletingId(reportId);
    try {
      await deleteReport(reportId);
      setReports((prev) => prev.filter((r) => r.report_id !== reportId));
      if (selectedReportId === reportId) setSelectedReportId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete report");
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
      setEmailErrorMsg(
        error instanceof Error ? error.message : "Failed to send email"
      );
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
    } catch (error) {
      setPreviewErrorId(reportId);
      setTimeout(() => setPreviewErrorId(null), 4000);
    }
  };

  const toggleReport = (reportId: string) =>
    setSelectedReportId((prev) => (prev === reportId ? null : reportId));

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-8 w-full sm:w-48" />
        </div>
        <Card>
          <div className="space-y-3 p-4">
            {[1, 2, 3].map((n) => (
              <Skeleton key={n} className="h-12 w-full" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Reports</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium text-destructive">Failed to load reports</p>
            <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Reports</h1>
        <Select value={selectedCompanyId} onValueChange={(v) => v && setSelectedCompanyId(v)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="All Companies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.company_id} value={c.company_id}>
                {c.company_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredReports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-base font-medium">No Reports Yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run intelligence agents on a company to generate reports.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Signals</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredReports.map((report) => {
                const rd = (report.report_data);
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
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(report.generated_at)}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-medium">
                      {getCompanyName(report.company_id)}
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
                           <span className="text-xs text-red-600">
                             {emailErrorMsg}
                           </span>
                         )}
                         {previewErrorId === report.report_id && (
                           <span className="text-xs text-red-600">
                             Preview failed
                           </span>
                         )}
                       </div>
                     </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}

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
                  {getCompanyName(selectedReport.company_id)} — {formatDate(selectedReport.generated_at)}
                </SheetTitle>
                <SheetDescription>
                  <Badge variant="outline">
                    {selectedReport.trigger === "cron" ? "Scheduled" : "Manual"}
                  </Badge>
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <ReportDetailCard
                  report={selectedReport}
                  companyName={getCompanyName(selectedReport.company_id)}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
              This report will be permanently deleted. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!!deletingId}
              onClick={() => deleteDialogId && handleDelete(deleteDialogId)}
            >
              {deletingId ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
