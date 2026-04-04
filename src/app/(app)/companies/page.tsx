"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Play } from "lucide-react";
import { toast } from "sonner";
import ShinyText from "@/components/ShinyText";
import {
  getCompanies,
  getCompanyBuckets,
  createTrackedCompanyBucket,
  renameTrackedCompanyBucket,
  deleteTrackedCompanyBucket,
  assignTrackedCompanyBucket,
  addAndTrackCompanySSE,
  searchCatalog,
  getOrgMembers,
  triggerManualPipelineRun,
  type TrackedCompany,
  type Company,
  type CompanyBucket,
  type OrganizationMember,
} from "@/lib/api/client";
import {
  companyMatchesSearchQuery,
  isExactEnoughCompanyMatch,
  looksLikeWebsiteQuery,
} from "@/lib/utils/company-search";
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
import {
  EntitySearchCombobox,
  type EntitySearchOption,
} from "@/components/entity-search-combobox";
import { SearchInput } from "@/components/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SKELETON_ROWS = ["row-a", "row-b", "row-c"];
const CATALOG_SEARCH_LIMIT = 12;

export default function CompaniesPage() {
  const router = useRouter();
  const { currentOrg, user } = useAuth();

  const [companies, setCompanies] = useState<TrackedCompany[]>([]);
  const [buckets, setBuckets] = useState<CompanyBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [manageBucketsOpen, setManageBucketsOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [creatingBucket, setCreatingBucket] = useState(false);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [bucketSavingId, setBucketSavingId] = useState<string | null>(null);
  const [bucketDeletingId, setBucketDeletingId] = useState<string | null>(null);
  const [bucketAssigningCompanyId, setBucketAssigningCompanyId] = useState<string | null>(null);

  // Add company dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<"search" | "url">("search");
  const [addUrl, setAddUrl] = useState("");
  const [addStoring, setAddStoring] = useState(false);
  const [addMsg, setAddMsg] = useState("");

  // Catalog state — loaded on dialog open, searched remotely
  const [catalogResults, setCatalogResults] = useState<Company[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Manual run dialog state
  const [runOpen, setRunOpen] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [runMembersLoading, setRunMembersLoading] = useState(false);
  const [orgMembers, setOrgMembers] = useState<OrganizationMember[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);

  const fetchCompanies = useCallback(async () => {
    try {
      const [{ companies: data }, bucketData] = await Promise.all([
        getCompanies(),
        getCompanyBuckets(),
      ]);
      setCompanies(data);
      setBuckets(bucketData);
      setRenameDrafts(
        Object.fromEntries(bucketData.map((bucket) => [bucket.bucket_id, bucket.name])),
      );
    } catch (err) {
      setCompanies([]);
      setBuckets([]);
      toast.error(err instanceof Error ? err.message : "Failed to load companies");
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
    setCatalogQuery("");
    setCatalogResults([]);
    setCatalogTotal(0);
  }, [addOpen]);

  // Debounced server search when filter changes (for better results)
  useEffect(() => {
    if (!addOpen || addMode !== "search") return;
    clearTimeout(debounceRef.current);
    setCatalogLoading(true);
    debounceRef.current = setTimeout(() => {
      searchCatalog(catalogQuery.trim() || undefined, undefined, CATALOG_SEARCH_LIMIT, 0)
        .then(({ companies: results, total }) => {
          setCatalogResults(results);
          setCatalogTotal(total);
        })
        .catch((err) => {
          setCatalogResults([]);
          setCatalogTotal(0);
          toast.error(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => setCatalogLoading(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [catalogQuery, addMode, addOpen]);

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
          setCatalogQuery("");
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
        setCatalogQuery("");
      },
      (err) => {
        setAddStoring(false);
        setAddMsg(`Error: ${err}`);
      },
    );
  };

  const resolveCatalogSelection = async (company: Company) => {
    if (isAlreadyTracking(company.company_id)) {
      setAddMsg(`${company.company_name} is already tracked.`);
      return;
    }

    await handleTrackFromCatalog(company.website_url);
  };

  const handleSubmitCatalogQuery = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const topResult = catalogResults[0];
    if (topResult && isExactEnoughCompanyMatch(topResult, trimmed)) {
      await resolveCatalogSelection(topResult);
      return;
    }

    if (looksLikeWebsiteQuery(trimmed)) {
      await handleTrackFromCatalog(
        trimmed.startsWith("http") ? trimmed : `https://${trimmed}`,
      );
      return;
    }

    setAddMsg(`No matching company found for "${trimmed}".`);
  };

  const filteredCompanies = companies.filter((c) => {
    if (!searchQuery.trim()) return true;
    return companyMatchesSearchQuery(c, searchQuery);
  });

  const catalogOptions: EntitySearchOption<Company>[] = catalogResults.map((company) => ({
    id: company.company_id,
    label: company.company_name,
    subtitle: `${company.domain}${company.industry ? ` · ${company.industry}` : ""}`,
    meta: isAlreadyTracking(company.company_id) ? "Tracking" : null,
    disabled: isAlreadyTracking(company.company_id),
    value: company,
  }));

  const selectedCompanies = companies.filter((company) =>
    selectedCompanyIds.includes(company.company_id),
  );

  const sortedBuckets = [...buckets].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );

  const bucketGroups = [
    ...sortedBuckets.map((bucket) => ({
      key: bucket.bucket_id,
      title: bucket.name,
      bucketId: bucket.bucket_id,
      companies: filteredCompanies.filter((company) => company.bucket_id === bucket.bucket_id),
    })),
    {
      key: "unassigned",
      title: "Unassigned",
      bucketId: null as string | null,
      companies: filteredCompanies.filter((company) => !company.bucket_id),
    },
  ].filter((group) => !searchQuery.trim() || group.companies.length > 0);

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

  const handleCreateBucket = async () => {
    const trimmed = newBucketName.trim();
    if (!trimmed) return;

    setCreatingBucket(true);
    try {
      const bucket = await createTrackedCompanyBucket(trimmed);
      setBuckets((prev) => [...prev, bucket]);
      setRenameDrafts((prev) => ({ ...prev, [bucket.bucket_id]: bucket.name }));
      setNewBucketName("");
      toast.success(`Created bucket "${bucket.name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create bucket");
    } finally {
      setCreatingBucket(false);
    }
  };

  const handleRenameBucket = async (bucketId: string) => {
    const nextName = renameDrafts[bucketId]?.trim() ?? "";
    if (!nextName) return;

    setBucketSavingId(bucketId);
    try {
      const bucket = await renameTrackedCompanyBucket(bucketId, nextName);
      setBuckets((prev) =>
        prev.map((entry) => (entry.bucket_id === bucketId ? bucket : entry)),
      );
      setRenameDrafts((prev) => ({ ...prev, [bucketId]: bucket.name }));
      toast.success(`Renamed bucket to "${bucket.name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename bucket");
    } finally {
      setBucketSavingId(null);
    }
  };

  const handleDeleteBucket = async (bucketId: string) => {
    setBucketDeletingId(bucketId);
    try {
      await deleteTrackedCompanyBucket(bucketId);
      setBuckets((prev) => prev.filter((bucket) => bucket.bucket_id !== bucketId));
      setRenameDrafts((prev) => {
        const next = { ...prev };
        delete next[bucketId];
        return next;
      });
      setCompanies((prev) =>
        prev.map((company) =>
          company.bucket_id === bucketId
            ? { ...company, bucket_id: null, bucket: null }
            : company,
        ),
      );
      toast.success("Deleted bucket.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete bucket");
    } finally {
      setBucketDeletingId(null);
    }
  };

  const handleAssignBucket = async (companyId: string, bucketId: string | null) => {
    setBucketAssigningCompanyId(companyId);
    try {
      await assignTrackedCompanyBucket(companyId, bucketId);
      setCompanies((prev) =>
        prev.map((company) => {
          if (company.company_id !== companyId) return company;
          const bucket = bucketId
            ? buckets.find((entry) => entry.bucket_id === bucketId) ?? null
            : null;
          return {
            ...company,
            bucket_id: bucketId,
            bucket,
          };
        }),
      );
      toast.success(bucketId ? "Bucket assigned." : "Company moved to Unassigned.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update bucket");
    } finally {
      setBucketAssigningCompanyId(null);
    }
  };

  const handleRunSelected = async () => {
    if (selectedCompanyIds.length === 0) return;

    setRunLoading(true);
    try {
      const result = await triggerManualPipelineRun({
        companyIds: selectedCompanyIds,
        recipientUserIds: selectedRecipientIds,
      });

      const companyCount =
        result.requestedCompanyCount ?? selectedCompanyIds.length;
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

  const renderBucketSelect = (
    company: TrackedCompany,
    options?: { compact?: boolean },
  ) => (
    <div
      className={`flex min-w-[12rem] flex-col gap-1 ${options?.compact ? "" : ""}`}
      onClick={(event) => event.stopPropagation()}
    >
      {!options?.compact ? (
        <Label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Bucket
        </Label>
      ) : null}
      <Select
        value={company.bucket_id ?? "unassigned"}
        onValueChange={(value) =>
          void handleAssignBucket(
            company.company_id,
            value === "unassigned" ? null : value,
          )
        }
        disabled={bucketAssigningCompanyId === company.company_id}
      >
        <SelectTrigger className={`h-8 bg-background text-xs ${options?.compact ? "min-w-[11rem]" : ""}`}>
          <SelectValue placeholder="Unassigned" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {sortedBuckets.map((bucket) => (
            <SelectItem key={bucket.bucket_id} value={bucket.bucket_id}>
              {bucket.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Tracked Companies</h1>
          <p className="text-sm text-muted-foreground">
            {companies.length} companies tracked
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Dialog open={manageBucketsOpen} onOpenChange={setManageBucketsOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline" />}>
              Manage Buckets
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Manage Buckets</DialogTitle>
                <DialogDescription>
                  Buckets are shared across your organization. Deleting a bucket
                  keeps its companies tracked and moves them back to Unassigned.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-bucket-name">Create bucket</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="new-bucket-name"
                      placeholder="e.g. Payments, AI Apps, Infra"
                      value={newBucketName}
                      onChange={(event) => setNewBucketName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && newBucketName.trim()) {
                          event.preventDefault();
                          void handleCreateBucket();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      disabled={creatingBucket || !newBucketName.trim()}
                      onClick={() => void handleCreateBucket()}
                    >
                      {creatingBucket ? "Creating..." : "Add"}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Existing buckets</Label>
                  {sortedBuckets.length === 0 ? (
                    <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
                      No buckets yet. Create one above to start grouping companies.
                    </div>
                  ) : (
                    <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                      {sortedBuckets.map((bucket) => {
                        const draftValue = renameDrafts[bucket.bucket_id] ?? bucket.name;
                        const isUpdating = bucketSavingId === bucket.bucket_id;
                        const isDeleting = bucketDeletingId === bucket.bucket_id;
                        const isDirty = draftValue.trim() !== bucket.name;

                        return (
                          <div
                            key={bucket.bucket_id}
                            className="rounded-lg border bg-muted/20 p-3"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Input
                                value={draftValue}
                                disabled={isUpdating || isDeleting}
                                onChange={(event) =>
                                  setRenameDrafts((prev) => ({
                                    ...prev,
                                    [bucket.bucket_id]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && draftValue.trim() && isDirty) {
                                    event.preventDefault();
                                    void handleRenameBucket(bucket.bucket_id);
                                  }
                                }}
                              />
                              <div className="flex items-center gap-2 sm:justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={isUpdating || isDeleting || !draftValue.trim() || !isDirty}
                                  onClick={() => void handleRenameBucket(bucket.bucket_id)}
                                >
                                  {isUpdating ? "Saving..." : "Save"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={isUpdating || isDeleting}
                                  onClick={() => void handleDeleteBucket(bucket.bucket_id)}
                                >
                                  {isDeleting ? "Deleting..." : "Delete"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setManageBucketsOpen(false)}
                >
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={addOpen}
            onOpenChange={(open) => {
              if (!addStoring) {
                setAddOpen(open);
                if (!open) {
                  setAddUrl("");
                  setAddMsg("");
                  setCatalogQuery("");
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
              <div className="flex flex-col gap-4 px-5 py-4">
                <EntitySearchCombobox
                  query={catalogQuery}
                  onQueryChange={setCatalogQuery}
                  options={catalogOptions}
                  loading={catalogLoading}
                  disabled={addStoring}
                  placeholder="Search company by name or website"
                  emptyMessage={
                    catalogQuery.trim()
                      ? `No companies match "${catalogQuery.trim()}".`
                      : "No companies in catalog yet."
                  }
                  submitLabel={addStoring ? "Adding..." : "Track"}
                  onSelectOption={(option) => resolveCatalogSelection(option.value)}
                  onSubmitQuery={handleSubmitCatalogQuery}
                />

                <p className="text-xs text-muted-foreground">
                  Search by company name or website. Press Enter to track the top exact-enough match, or enter a website to add a new company.
                </p>

                <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {catalogLoading
                      ? "Searching catalog..."
                      : `${catalogOptions.length} result${catalogOptions.length === 1 ? "" : "s"} shown${catalogQuery.trim() ? ` for "${catalogQuery.trim()}"` : ""}`}
                    {!catalogLoading && !catalogQuery.trim()
                      ? ` · ${catalogTotal} companies in catalog`
                      : ""}
                  </p>
                  {addMsg ? (
                    <p
                      className={`text-xs ${addMsg.startsWith("Error") ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {addMsg}
                    </p>
                  ) : null}
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
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          placeholder="Search tracked companies..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
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
              render={(
                <Button
                  size="sm"
                  className="w-full min-w-[9rem] sm:w-auto"
                  disabled={selectedCompanyIds.length === 0}
                />
              )}
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
          <p className="text-sm font-medium">
            {searchQuery.trim() ? `No results for "${searchQuery.trim()}"` : "No companies tracked"}
          </p>
          <p className="text-xs text-muted-foreground">
            {searchQuery.trim()
              ? "Try a different search term."
              : 'Click "Add Company" to search our catalog or add by URL.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {bucketGroups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">{group.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {group.companies.length} compan{group.companies.length === 1 ? "y" : "ies"}
                  </p>
                </div>
              </div>

              {group.companies.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
                  No companies in this bucket yet.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:hidden">
                    {group.companies.map((company) => (
                      <div
                        key={company.company_id}
                        className="rounded-xl border bg-card p-4 shadow-sm"
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedCompanyIds.includes(company.company_id)}
                            onCheckedChange={(checked) =>
                              toggleCompanySelection(company.company_id, checked === true)
                            }
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${company.company_name}`}
                            className="mt-1"
                          />
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 flex-col items-start gap-3 text-left"
                            onClick={() => router.push(`/companies/${company.company_id}`)}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="break-words text-sm font-semibold leading-snug">
                                  {company.company_name}
                                </span>
                                {company.platform_status === "enriching" && (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                                )}
                              </div>
                              <p className="mt-1 break-all text-xs text-muted-foreground">
                                {company.domain}
                              </p>
                            </div>

                            <div className="grid w-full gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                              <div className="rounded-lg bg-muted/40 px-3 py-2">
                                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/80">
                                  Industry
                                </span>
                                <span className="mt-1 block">
                                  {company.platform_status === "enriching" && !company.industry ? (
                                    <ShinyText text="Enriching..." className="text-xs" />
                                  ) : (
                                    company.industry ?? "—"
                                  )}
                                </span>
                              </div>
                              <div className="rounded-lg bg-muted/40 px-3 py-2">
                                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/80">
                                  Last Updated
                                </span>
                                <span className="mt-1 block">
                                  {company.platform_status === "enriching" && !company.last_agent_run ? (
                                    <ShinyText text="Enriching..." className="text-xs" />
                                  ) : company.last_agent_run ? (
                                    new Date(company.last_agent_run).toLocaleDateString()
                                  ) : (
                                    "—"
                                  )}
                                </span>
                              </div>
                            </div>
                          </button>
                        </div>

                        <div className="mt-4">
                          {renderBucketSelect(company)}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-xl border md:block">
                    <Table className="w-full table-fixed lg:table-auto">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Select</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead className="w-[10rem]">Domain</TableHead>
                          <TableHead className="hidden lg:table-cell">Industry</TableHead>
                          <TableHead className="hidden lg:table-cell">Last Updated</TableHead>
                          <TableHead className="w-[15rem]">Bucket</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.companies.map((company) => (
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
                              <span className="flex min-w-0 items-center gap-2 break-words">
                                {company.company_name}
                                {company.platform_status === "enriching" && (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-[10rem] break-all whitespace-normal text-muted-foreground">
                              {company.domain}
                            </TableCell>
                            <TableCell className="hidden text-muted-foreground lg:table-cell">
                              {company.platform_status === "enriching" && !company.industry
                                ? <ShinyText text="Enriching..." className="text-sm" />
                                : company.industry ?? "—"}
                            </TableCell>
                            <TableCell className="hidden text-muted-foreground lg:table-cell">
                              {company.platform_status === "enriching" && !company.last_agent_run
                                ? <ShinyText text="Enriching..." className="text-sm" />
                                : company.last_agent_run
                                  ? new Date(company.last_agent_run).toLocaleDateString()
                                  : "—"}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {renderBucketSelect(company, { compact: true })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
