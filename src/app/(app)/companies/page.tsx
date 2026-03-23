"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import ShinyText from "@/components/ShinyText";
import {
  getCompanies,
  addAndTrackCompanySSE,
  searchCatalog,
  type TrackedCompany,
  type Company,
} from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";
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
import { Skeleton } from "@/components/ui/skeleton";

const SKELETON_ROWS = ["row-a", "row-b", "row-c"];
const CATALOG_DISPLAY_LIMIT = 15;

export default function CompaniesPage() {
  const router = useRouter();
  const { currentOrg } = useAuth();

  const [companies, setCompanies] = useState<TrackedCompany[]>([]);
  const [trackingLimit, setTrackingLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

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
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Company</DialogTitle>
            </DialogHeader>

            <div className="flex gap-2 border-b pb-2">
              <button
                type="button"
                className={`text-sm px-3 py-1 rounded-md transition-colors ${addMode === "search" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAddMode("search")}
              >
                Search Catalog
              </button>
              <button
                type="button"
                className={`text-sm px-3 py-1 rounded-md transition-colors ${addMode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setAddMode("url")}
              >
                Add by URL
              </button>
            </div>

            {addMode === "search" ? (
              <div className="flex flex-col gap-3 py-2">
                <Input
                  placeholder="Filter companies..."
                  value={catalogFilter}
                  onChange={(e) => setCatalogFilter(e.target.value)}
                  disabled={addStoring}
                  autoFocus
                />

                {catalogLoading ? (
                  <div className="flex flex-col gap-1.5">
                    {[1, 2, 3].map((k) => (
                      <Skeleton key={k} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Showing {displayedCatalog.length} of {catalogTotal} companies
                      {catalogFilter.trim() ? ` matching "${catalogFilter.trim()}"` : " in catalog"}
                    </p>

                    <div className="flex flex-col gap-1 max-h-[360px] overflow-y-auto">
                      {displayedCatalog.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          {catalogFilter.trim()
                            ? <>No companies match &ldquo;{catalogFilter.trim()}&rdquo;. Try &ldquo;Add by URL&rdquo; to add a new company.</>
                            : "No companies in catalog yet."
                          }
                        </p>
                      ) : (
                        displayedCatalog.map((c) => (
                          <div
                            key={c.company_id}
                            className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-medium truncate">{c.company_name}</span>
                              <span className="text-xs text-muted-foreground truncate">
                                {c.domain}
                                {c.industry ? ` · ${c.industry}` : ""}
                              </span>
                            </div>
                            {isAlreadyTracking(c.company_id) ? (
                              <span className="text-xs text-muted-foreground shrink-0">Tracking</span>
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
                        ))
                      )}
                    </div>

                    {filteredCatalog.length > CATALOG_DISPLAY_LIMIT && (
                      <p className="text-xs text-muted-foreground text-center">
                        {filteredCatalog.length - CATALOG_DISPLAY_LIMIT} more — refine your search to see them
                      </p>
                    )}
                  </>
                )}

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
              </div>
            ) : (
              <form onSubmit={handleAddByUrl} className="flex flex-col gap-4 py-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-url">Website URL</Label>
                  <Input
                    id="company-url"
                    placeholder="e.g. stripe.com"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    disabled={addStoring}
                  />
                  <p className="text-xs text-muted-foreground">
                    If this company isn&apos;t in our database, it will be added automatically.
                  </p>
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
                    {addStoring ? "Adding..." : "Add & Track"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Input
        placeholder="Search tracked companies..."
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
            Click &ldquo;Add Company&rdquo; to search our catalog or add by URL.
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
