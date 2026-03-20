"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import {
  getCompanies,
  deleteCompany,
  storeCompanySSE,
  getSignalDefinitions,
  createSignalDefinition,
  type Company,
} from "@/lib/api/client";
import type { SignalDefinition } from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRuns } from "@/lib/context/RunsContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { RunProgressRing } from "@/components/RunProgressRing";
import { ActiveRunModal } from "@/components/ActiveRunModal";

const SKELETON_ROWS = ["row-a", "row-b", "row-c"];

interface PendingSignal {
  id: string;
  name: string;
  target_url: string;
  search_instructions: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export default function CompaniesPage() {
  const router = useRouter();
  const { currentOrg } = useAuth();
  const { activeRuns } = useRuns();
  const [runModalCompanyId, setRunModalCompanyId] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyLimit, setCompanyLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addStoring, setAddStoring] = useState(false);
  const [addMsg, setAddMsg] = useState("");

  const [globalSignals, setGlobalSignals] = useState<SignalDefinition[]>([]);
  const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
  const [pendingFormOpen, setPendingFormOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState({
    name: "",
    target_url: "",
    search_instructions: "",
  });

  const fetchCompanies = useCallback(async () => {
    try {
      const { companies: data, company_limit } = await getCompanies();
      setCompanies(data);
      setCompanyLimit(company_limit);
    } catch {
      setCompanies([]);
    }
  }, []);

  useEffect(() => {
    if (!currentOrg) return;
    setLoading(true);
    fetchCompanies().finally(() => setLoading(false));
  }, [currentOrg, fetchCompanies]);

  useEffect(() => {
    if (!addOpen) return;
    getSignalDefinitions()
      .then((defs) => setGlobalSignals(defs.filter((d) => d.scope === "global" && d.enabled)))
      .catch(() => setGlobalSignals([]));
  }, [addOpen]);

  const handleDelete = async (id: string) => {
    try {
      await deleteCompany(id);
      await fetchCompanies();
    } catch {
      console.error("[COMPANIES] Failed to delete company");
    }
  };

  const handleAddCompany = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addUrl.trim();
    if (!trimmed) return;

    if (companies.length >= companyLimit) {
      setAddMsg(`Maximum ${companyLimit} companies. Delete one before adding.`);
      return;
    }

    let finalUrl = trimmed;
    if (!finalUrl.startsWith("http")) finalUrl = `https://${finalUrl}`;

    setAddStoring(true);
    setAddMsg("Storing company...");

    let storedCompanyId: string | null = null;

    storeCompanySSE(
      finalUrl,
      (event) => {
       if (event.type === "company_stored") {
           setAddMsg("Company stored! Running discovery...");
           const data = event.data as { company_id?: string };
           storedCompanyId = data?.company_id ?? null;
         }
      },
      async () => {
        if (storedCompanyId && pendingSignals.length > 0) {
          await Promise.allSettled(
            pendingSignals.map((s) =>
              createSignalDefinition({
                name: s.name,
                signal_type: slugify(s.name),
                display_name: s.name,
                target_url: s.target_url,
                search_instructions: s.search_instructions,
                scope: "company",
                company_id: storedCompanyId,
              }),
            ),
          );
        }
        setAddStoring(false);
        setAddMsg("");
        setAddUrl("");
        setPendingSignals([]);
        setAddOpen(false);
        await fetchCompanies();
      },
      (err) => {
        setAddStoring(false);
        setAddMsg(`Error: ${err}`);
      },
    );
  };

  const isRunningOrQueued = (companyId: string) =>
    activeRuns.some((r) => r.companyId === companyId && !r.isComplete);

  const isQueuedOnly = (companyId: string) =>
    activeRuns.some(
      (r) => r.companyId === companyId && !r.isComplete && r.queued,
    );

  const filteredCompanies = companies.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.company_name.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      (c.industry?.toLowerCase().includes(q) ?? false)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length}/{companyLimit} companies tracked
          </p>
        </div>

        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            if (!addStoring) {
              setAddOpen(open);
              if (!open) {
                setAddUrl("");
                setAddMsg("");
                setPendingSignals([]);
                setPendingFormOpen(false);
                setPendingForm({ name: "", target_url: "", search_instructions: "" });
              }
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="h-4 w-4" />
            Add Company
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={handleAddCompany}
              className="flex flex-col gap-4 py-2"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-url">Website URL</Label>
                <Input
                  id="company-url"
                  placeholder="e.g. stripe.com"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  disabled={addStoring}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Global Signals
                  </p>
                  <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 min-h-[120px]">
                    {globalSignals.length === 0 ? (
                      <p className="text-xs text-muted-foreground p-1">No global signals configured</p>
                    ) : (
                      globalSignals.map((s) => (
                        <div key={s.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 bg-background border text-xs">
                          <span className="flex-1 truncate">{s.display_name}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Custom Signals
                  </p>
                  <div className="flex flex-col gap-1 rounded-md border bg-muted/30 p-2 min-h-[120px]">
                    {pendingSignals.map((s) => (
                      <div key={s.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 bg-background border text-xs">
                        <span className="flex-1 truncate">{s.name}</span>
                        <button
                          type="button"
                          onClick={() => setPendingSignals((prev) => prev.filter((p) => p.id !== s.id))}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <Dialog
                      open={pendingFormOpen}
                      onOpenChange={(open) => {
                        setPendingFormOpen(open);
                        if (!open) setPendingForm({ name: "", target_url: "", search_instructions: "" });
                      }}
                    >
                      <DialogTrigger render={
                        <button
                          type="button"
                          disabled={addStoring}
                          className="w-full rounded-md border border-dashed border-muted-foreground/40 py-1.5 text-xs text-muted-foreground hover:border-muted-foreground/70 hover:text-foreground transition-colors mt-1"
                        />
                      }>
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
                              value={pendingForm.name}
                              onChange={(e) => setPendingForm((p) => ({ ...p, name: e.target.value }))}
                              autoFocus
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Target URL</Label>
                            <Input
                              placeholder="e.g. {website_url}/blog or https://example.com/blog"
                              value={pendingForm.target_url}
                              onChange={(e) => setPendingForm((p) => ({ ...p, target_url: e.target.value }))}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>Search instructions</Label>
                            <Textarea
                              placeholder="What to look for..."
                              value={pendingForm.search_instructions}
                              onChange={(e) => setPendingForm((p) => ({ ...p, search_instructions: e.target.value }))}
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
                              setPendingFormOpen(false);
                              setPendingForm({ name: "", target_url: "", search_instructions: "" });
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            disabled={!pendingForm.name.trim()}
                            onClick={() => {
                              setPendingSignals((prev) => [
                                ...prev,
                                { id: crypto.randomUUID(), ...pendingForm },
                              ]);
                              setPendingForm({ name: "", target_url: "", search_instructions: "" });
                              setPendingFormOpen(false);
                            }}
                          >
                            Add Signal
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </div>

              {addMsg && (
                <p
                  className={
                    addMsg.startsWith("Error")
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {addMsg}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!addStoring) {
                      setAddOpen(false);
                      setAddUrl("");
                      setAddMsg("");
                      setPendingSignals([]);
                      setPendingFormOpen(false);
                      setPendingForm({ name: "", target_url: "", search_instructions: "" });
                    }
                  }}
                  disabled={addStoring}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={addStoring || !addUrl.trim()}>
                  {addStoring ? "Storing..." : "Add Company"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Input
        placeholder="Search companies..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-sm"
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {SKELETON_ROWS.map((k) => (
            <Skeleton key={k} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : filteredCompanies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-16 text-center">
          <p className="text-sm font-medium">No companies tracked</p>
          <p className="text-xs text-muted-foreground">
            Click &ldquo;Add Company&rdquo; to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.map((company) => {
                const running = isRunningOrQueued(company.company_id);
                const queued = isQueuedOnly(company.company_id);
                const activeRun = activeRuns.find(
                  (r) => r.companyId === company.company_id && !r.isComplete,
                );
                return (
                  <TableRow
                    key={company.company_id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/companies/${company.company_id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/companies/${company.company_id}`);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {company.company_name}
                        {activeRun && !queued && activeRun.agents.length > 0 && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <RunProgressRing run={activeRun} onClick={() => setRunModalCompanyId(company.company_id)} />
                          </span>
                        )}
                        {activeRun && !queued && activeRun.agents.length === 0 && (
                          <Badge variant="default" className="text-[10px] cursor-pointer" onClick={(e) => { e.stopPropagation(); setRunModalCompanyId(company.company_id); }}>
                            Starting
                          </Badge>
                        )}
                        {queued && (
                          <Badge variant="outline" className="text-[10px] cursor-pointer" onClick={(e) => { e.stopPropagation(); setRunModalCompanyId(company.company_id); }}>
                            Queued
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.domain}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.industry ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {company.last_agent_run
                        ? new Date(
                            company.last_agent_run,
                          ).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="icon-sm" variant="ghost" onClick={(e) => e.stopPropagation()} />
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="sr-only">
                            Delete {company.company_name}
                          </span>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete Company
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This will remove{" "}
                              <strong>{company.company_name}</strong> and
                              all its reports and signals. This action
                              cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() =>
                                handleDelete(company.company_id)
                              }
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ActiveRunModal
        companyId={runModalCompanyId}
        onOpenChange={(open) => { if (!open) setRunModalCompanyId(null); }}
      />

    </div>
  );
}
