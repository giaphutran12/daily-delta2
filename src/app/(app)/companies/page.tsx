"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Play } from "lucide-react";
import { toast } from "sonner";
import ShinyText from "@/components/ShinyText";
import {
  getCompanies,
  addAndTrackCompanySSE,
  searchCatalog,
  getOrgMembers,
  triggerManualPipelineRun,
  type TrackedCompany,
  type Company,
  type OrganizationMember,
} from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = ["row-a", "row-b", "row-c"];
const CATALOG_DISPLAY_LIMIT = 15;

export default function CompaniesPage() {
  const router = useRouter();
  const { currentOrg, user } = useAuth();

  const [companies, setCompanies] = useState<TrackedCompany[]>([]);
  const [trackingLimit, setTrackingLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);

  // Add company dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"search" | "url">("search");
  const [addUrl, setAddUrl] = useState("");
  const [addStoring, setAddStoring] = useState(false);
  const [addMsg, setAddMsg] = useState("");

  // Catalog state — loaded on dialog open, filtered client-side
  const [catalogAll, setCatalogAll] = useState<Company[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Manual run dialog state
  const [runOpen, setRunOpen] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runMembersLoading, setRunMembersLoading] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);

  const fetchCompanies = useCallback(async () => {
    try {
      const { companies: data, tracking_limit } = await getCompanies();
      setCompanies(data);
      setTrackingLimit(tracking_limit);
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
    setSelectedCompanyIds((prev) =>
      prev.filter((companyId) =>
        companies.some((company) => company.company_id === companyId),
      ),
    );
  }, [companies]);

  // Load catalog when dialog opens
  useEffect(() => {
    if (!addOpen) return;
    setCatalogLoading(true);
    setCatalogFilter("");
    searchCatalog(undefined, undefined, 500, 0)
      .then(({ companies: results, total }) => {
        setCatalogAll(results);
        setCatalogTotal(total);
      })
      .catch((err) => {
        console.error("[CATALOG] Failed to load catalog:", err);
        setCatalogAll([]);
        setCatalogTotal(0);
      })
      .finally(() => setCatalogLoading(false));
  }, [addOpen]);

  // Debounced server search when filter changes (for better results)
  useEffect(() => {
    if (!addOpen || !catalogFilter.trim()) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchCatalog(catalogFilter.trim(), undefined, 500, 0)
        .then(({ companies: results, total }) => {
          setCatalogAll(results);
          setCatalogTotal(total);
        })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [catalogFilter, addOpen]);

  useEffect(() => {
    if (!runOpen || !currentOrg) return;

    setRunMembersLoading(true);
    getOrgMembers(currentOrg.organization_id)
      .then((members) => {
        setOrgMembers(
          members.filter(
            (member) =>
              member.user_id !== null &&
              member.status !== "pending" &&
              member.user_id !== user?.id,
          ),
        );
      })
      .catch(() => setOrgMembers([]))
      .finally(() => setRunMembersLoading(false));
  }, [runOpen, currentOrg, user?.id]);

  const handleAddByUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addUrl.trim();
    if (!trimmed) return;

    let finalUrl = trimmed;
    if (!finalUrl.startsWith("http")) finalUrl = `https://${finalUrl}`;

    setAddStoring(true);
    setAddMsg("Adding company...");

    addAndTrackCompanySSE(
      finalUrl,
      (event) => {
        if (event.type === "company_stored") {
          setAddMsg("Company added and tracked!");
        }
        if (event.type === "pipeline_complete") {
          setAddStoring(false);
          setAddMsg("");
          setAddUrl("");
          setAddOpen(false);
          void fetchCompanies();
        }
        if (event.type === "discovery_complete") {
          void fetchCompanies();
        }
      },
      async () => {
        // Stream closed — ensure dialog is cleaned up (no-op if already handled)
        setAddStoring(false);
        setAddMsg("");
        setAddUrl("");
        setAddOpen(false);
      },
      (err) => {
        setAddStoring(false);
        setAddMsg(`Error: ${err}`);
      },
    );
  };

  const isAlreadyTracking = (companyId: string) =>
    companies.some((c) => c.company_id === companyId);

  const handleTrackFromCatalog = async (companyUrl: string) => {
    setAddStoring(true);
    setAddMsg("Tracking company...");

    addAndTrackCompanySSE(
      companyUrl,
      (event) => {
        if (event.type === "pipeline_complete") {
          setAddStoring(false);
          setAddMsg("");
          setAddOpen(false);
          setCatalogFilter("");
          void fetchCompanies();
        }
        if (event.type === "discovery_complete") {
          void fetchCompanies();
        }
      },
      async () => {
        setAddStoring(false);
        setAddMsg("");
        setAddOpen(false);
        setCatalogFilter("");
      },
      (err) => {
        setAddStoring(false);
        setAddMsg(`Error: ${err}`);
      },
    );
  };

  // Client-side filter on catalog results
  const filteredCatalog = catalogFilter.trim()
    ? (catalogAll ?? []).filter((c) => {
        const q = catalogFilter.toLowerCase();
        return (
          c.company_name.toLowerCase().includes(q) ||
          c.domain.toLowerCase().includes(q) ||
          (c.industry?.toLowerCase().includes(q) ?? false)
        );
      })
    : (catalogAll ?? []);

  const displayedCatalog = filteredCatalog.slice(0, CATALOG_DISPLAY_LIMIT);

  const filteredCompanies = companies.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.company_name.toLowerCase().includes(q) ||
      c.domain.toLowerCase().includes(q) ||
      (c.industry?.toLowerCase().includes(q) ?? false)
    );
  });

  const selectedCompanies = companies.filter((company) =>
    selectedCompanyIds.includes(company.company_id),
  );

  const allVisibleSelected =
    filteredCompanies.length > 0 &&
    filteredCompanies.every((company) =>
      selectedCompanyIds.includes(company.company_id),
    );

  const toggleCompanySelection = (companyId: string, checked: boolean) => {
    setSelectedCompanyIds((prev) => {
      if (checked) {
        return prev.includes(companyId) ? prev : [...prev, companyId];
      }
      return prev.filter((id) => id !== companyId);
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedCompanyIds((prev) => {
      const visibleIds = filteredCompanies.map((company) => company.company_id);
      if (visibleIds.length === 0) return prev;
      if (visibleIds.every((companyId) => prev.includes(companyId))) {
        return prev.filter((companyId) => !visibleIds.includes(companyId));
      }
      return [...new Set([...prev, ...visibleIds])];
    });
  };

  const toggleRecipientSelection = (userId: string, checked: boolean) => {
    setSelectedRecipientIds((prev) => {
      if (checked) {
        return prev.includes(userId) ? prev : [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const resetRunDialog = () => {
    setRunOpen(false);
    setSelectedRecipientIds([]);
  };

  const handleRunSelected = async () => {
    if (selectedCompanyIds.length === 0) return;

    setRunLoading(true);
    try {
      const result = await triggerManualPipelineRun({
        companyIds: selectedCompanyIds,
        recipientUserIds: selectedRecipientIds,
      });

      const companyCount = result.requested_company_count ?? selectedCompanyIds.length;
      toast.success(
        companyCount === 1
          ? "Manual run queued. The report email will go to you by default."
          : `Manual run queued for ${companyCount} companies. One combined email will go to you by default.`,
      );
      setSelectedCompanyIds([]);
      resetRunDialog();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to queue manual run",
      );
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Tracked Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length}/{trackingLimit} companies tracked
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
                setCatalogFilter("");
                setAddMode("search");
              }
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            <Plus className="h-4 w-4" />
            Add Company
          </DialogTrigger>
          <DialogContent className="flex flex-col sm:max-w-lg max-h-[90vh] p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-5 pt-5 pb-0 shrink-0">
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>

            {/* Mode tabs */}
            <div className="flex gap-1 px-5 pt-3 pb-0 border-b shrink-0">
              <button
                type="button"
                className={`text-sm px-3 py-1.5 rounded-t-md transition-colors border-b-2 -mb-px ${addMode === "search" ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAddMode("search")}
              >
                Search Catalog
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1.5 rounded-t-md transition-colors border-b-2 -mb-px ${addMode === "url" ? "border-primary text-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAddMode("url")}
              >
                Add by URL
              </button>
            </div>

            {addMode === "search" ? (
              <div className="flex flex-col min-h-0 flex-1">
                {/* Sticky search */}
                <div className="px-5 pt-4 pb-2 shrink-0">
                  <Input
                    placeholder="Filter companies..."
                    value={catalogFilter}
                    onChange={(e) => setCatalogFilter(e.target.value)}
                    disabled={addStoring}
                    autoFocus
                  />
                </div>

                {/* Scrollable list */}
                <div className="flex-1 overflow-y-auto px-5 min-h-0">
                  {catalogLoading ? (
                    <div className="flex flex-col gap-2 py-2">
                      {[1, 2, 3, 4, 5].map((k) => (
                        <Skeleton key={k} className="h-12 w-full rounded-md" />
                      ))}
                    </div>
                  ) : displayedCatalog.length === 0 ? (
                    <div className="flex items-center justify-center py-10">
                      <p className="text-xs text-muted-foreground text-center">
                        {catalogFilter.trim()
                          ? <>No companies match &ldquo;{catalogFilter.trim()}&rdquo;.<br />Switch to &ldquo;Add by URL&rdquo; to add a new one.</>
                          : "No companies in catalog yet."
                        }
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5 py-2">
                      {displayedCatalog.map((c) => (
                        <div
                          key={c.company_id}
                          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="text-sm font-medium truncate leading-snug">{c.company_name}</span>
                            <span className="text-xs text-muted-foreground truncate mt-0.5">
                              {c.domain}
                              {c.industry ? ` · ${c.industry}` : ""}
                            </span>
                          </div>
                          {isAlreadyTracking(c.company_id) ? (
                            <span className="text-xs text-muted-foreground shrink-0 px-2">Tracking</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              disabled={addStoring}
                              onClick={() => handleTrackFromCatalog(c.website_url)}
                            >
                              Track
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sticky footer */}
                <div className="px-5 py-3 border-t bg-muted/30 shrink-0 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {catalogLoading
                      ? "Loading catalog…"
                      : `Showing ${displayedCatalog.length} of ${catalogTotal} companies${catalogFilter.trim() ? ` matching "${catalogFilter.trim()}"` : ""}`
                    }
                    {!catalogLoading && filteredCatalog.length > CATALOG_DISPLAY_LIMIT && (
                      <> &mdash; {filteredCatalog.length - CATALOG_DISPLAY_LIMIT} more, refine to see them</>
                    )}
                  </p>
                  {addMsg && (
                    <p className={`text-xs shrink-0 ${addMsg.startsWith("Error") ? "text-destructive" : "text-muted-foreground"}`}>
                      {addMsg}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddByUrl} className="flex flex-col gap-4 px-5 py-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-url">Website URL</Label>
                  <Input
                    id="company-url"
                    placeholder="e.g. stripe.com"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    disabled={addStoring}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    If this company isn&apos;t in our database, it will be added and enriched automatically.
                  </p>
                </div>

                {addMsg && (
                  <p className={addMsg.startsWith("Error") ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                    {addMsg}
                  </p>
                )}

                <DialogFooter className="pt-2">
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
                    {addStoring ? "Adding..." : "Add & Track"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Input
          placeholder="Search tracked companies..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={filteredCompanies.length === 0}
            onClick={toggleVisibleSelection}
          >
            {allVisibleSelected ? "Clear visible selection" : "Select visible"}
          </Button>

          <Dialog
            open={runOpen}
            onOpenChange={(open) => {
              if (!runLoading) {
                if (!open) {
                  setSelectedRecipientIds([]);
                }
                setRunOpen(open);
              }
            }}
          >
            <DialogTrigger
              render={<Button size="sm" disabled={selectedCompanyIds.length === 0} />}
            >
              <Play className="h-4 w-4" />
              Run Selected
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Run Selected Companies</DialogTitle>
                <DialogDescription>
                  This queues one explicit manual request for the selected companies.
                  You&apos;ll get one combined report email by default.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Selected companies</Label>
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                    {selectedCompanies.map((company) => (
                      <div
                        key={company.company_id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="font-medium">{company.company_name}</span>
                        <span className="text-xs text-muted-foreground">
                          {company.domain}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Default delivery</Label>
                  <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                    This run will send the digest to{" "}
                    <span className="font-medium text-foreground">
                      {user?.email ?? "you"}
                    </span>{" "}
                    by default.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Also send to teammates</Label>
                  <div className="rounded-lg border p-3">
                    {runMembersLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading organization members...
                      </div>
                    ) : orgMembers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No additional organization members are available yet.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {orgMembers.map((member) => (
                          <label
                            key={member.id}
                            className="flex items-start gap-3 rounded-md"
                          >
                            <Checkbox
                              checked={selectedRecipientIds.includes(member.user_id!)}
                              onCheckedChange={(checked) =>
                                toggleRecipientSelection(
                                  member.user_id!,
                                  checked === true,
                                )
                              }
                            />
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {member.email ?? member.user_id}
                              </span>
                              <span className="text-xs capitalize text-muted-foreground">
                                {member.role}
                              </span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetRunDialog}
                  disabled={runLoading}
                >
                  Cancel
                </Button>
                <Button onClick={handleRunSelected} disabled={runLoading}>
                  {runLoading ? "Queueing..." : "Queue manual run"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

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
            Click &ldquo;Add Company&rdquo; to search our catalog or add by URL.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Select</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Last Updated</TableHead>

              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCompanies.map((company) => (
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedCompanyIds.includes(company.company_id)}
                      onCheckedChange={(checked) =>
                        toggleCompanySelection(company.company_id, checked === true)
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {company.company_name}
                      {company.platform_status === "enriching" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.domain}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.platform_status === "enriching" && !company.industry
                      ? <ShinyText text="Enriching..." className="text-sm" />
                      : company.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {company.platform_status === "enriching" && !company.last_agent_run
                      ? <ShinyText text="Enriching..." className="text-sm" />
                      : company.last_agent_run
                        ? new Date(company.last_agent_run).toLocaleDateString()
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
