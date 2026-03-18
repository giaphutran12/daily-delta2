"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Play } from "lucide-react";
import {
  getCompanies,
  deleteCompany,
  storeCompanySSE,
  type Company,
} from "@/lib/api/client";
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

const SKELETON_ROWS = ["row-a", "row-b", "row-c"];

export default function CompaniesPage() {
  const { currentOrg } = useAuth();
  const router = useRouter();
  const { activeRuns, handleRunCompany } = useRuns();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyLimit, setCompanyLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addStoring, setAddStoring] = useState(false);
  const [addMsg, setAddMsg] = useState("");

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

    storeCompanySSE(
      finalUrl,
      (event) => {
        if (event.type === "company_stored") {
          setAddMsg("Company stored! Running discovery...");
        }
      },
      async () => {
        setAddStoring(false);
        setAddMsg("");
        setAddUrl("");
        setAddOpen(false);
        await fetchCompanies();
      },
      (err) => {
        setAddStoring(false);
        setAddMsg(`Error: ${err}`);
      },
    );
  };

  const onRunCompany = (company: Company) => {
    handleRunCompany(company);
    router.push("/active-runs");
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
              }
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="h-4 w-4" />
            Add Company
          </DialogTrigger>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={handleAddCompany}
              className="flex flex-col gap-3 py-2"
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.map((company) => {
                const running = isRunningOrQueued(company.company_id);
                const queued = isQueuedOnly(company.company_id);
                return (
                  <TableRow key={company.company_id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {company.company_name}
                        {running && !queued && (
                          <Badge variant="default" className="text-[10px]">
                            Running
                          </Badge>
                        )}
                        {queued && (
                          <Badge variant="outline" className="text-[10px]">
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRunCompany(company)}
                          disabled={running}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {running
                            ? queued
                              ? "Queued"
                              : "Running"
                            : "Run Agents"}
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button size="icon-sm" variant="ghost" />
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
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
