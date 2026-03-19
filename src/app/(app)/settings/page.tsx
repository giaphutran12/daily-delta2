"use client";

import { useState, useEffect } from "react";
import {
  getUserSettings,
  setEmail,
  setEmailFrequency,
  getOrgMembers,
  inviteMember,
  removeMember,
  cancelInvitation,
  createOrganization,
  getSignalDefinitions,
  createSignalDefinition,
  updateSignalDefinition,
  deleteSignalDefinition,
  toggleSignalDefinition,
  getCompanies,
  type EmailFrequency,
} from "@/lib/api/client";
import type { OrganizationMember, SignalDefinition, Company } from "@/lib/types";
import { useAuth } from "@/lib/auth/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, PencilIcon, TrashIcon } from "lucide-react";

type SignalFormData = {
  name: string;
  display_name: string;
  signal_type: string;
  target_url: string;
  search_instructions: string;
  scope: "global" | "company";
  company_id: string | null;
};

const EMPTY_SIGNAL_FORM: SignalFormData = {
  name: "",
  display_name: "",
  signal_type: "",
  target_url: "",
  search_instructions: "",
  scope: "global",
  company_id: null,
};

const FREQUENCY_OPTIONS: { value: EmailFrequency; label: string; desc: string }[] = [
  { value: "daily", label: "Daily", desc: "Every day at 7:00 AM" },
  { value: "every_3_days", label: "Every 3 Days", desc: "Once every 3 days" },
  { value: "weekly", label: "Weekly", desc: "Once a week" },
  { value: "monthly", label: "Monthly", desc: "Once a month" },
  { value: "only_on_run", label: "Only On Run", desc: "Only when you manually run agents" },
];

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export default function SettingsPage() {
  const { user, currentOrg, organizations, setCurrentOrg, refreshOrgs } =
    useAuth();

  const [frequency, setFrequencyState] = useState<EmailFrequency>("only_on_run");
  const [deliveryEmail, setDeliveryEmail] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState("");
  const [createOrgLoading, setCreateOrgLoading] = useState(false);
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);

  const [signalDefs, setSignalDefs] = useState<SignalDefinition[]>([]);
  const [signalDefsLoading, setSignalDefsLoading] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [signalDialogOpen, setSignalDialogOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<SignalDefinition | undefined>();
  const [signalForm, setSignalForm] = useState<SignalFormData>({ ...EMPTY_SIGNAL_FORM });
  const [signalFormError, setSignalFormError] = useState<string | null>(null);
  const [signalFormSaving, setSignalFormSaving] = useState(false);
  const [deleteSignalId, setDeleteSignalId] = useState<string | null>(null);

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);

  useEffect(() => {
    getUserSettings()
      .then((s) => {
        if (s.email) setDeliveryEmail(s.email);
        else if (user?.email) setDeliveryEmail(user.email);
        if (s.email_frequency) setFrequencyState(s.email_frequency);
      })
      .catch(() => {});
  }, [user?.email]);

  const handleSaveEmail = async () => {
    if (!deliveryEmail.trim()) return;
    setIsSavingEmail(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      await setEmail(deliveryEmail.trim());
      setEmailSuccess("Delivery email updated successfully.");
    } catch (err) {
      setEmailError((err as Error).message ?? "Failed to update email.");
    } finally {
      setIsSavingEmail(false);
    }
  };

  useEffect(() => {
    if (!currentOrg) return;
    setMembersLoading(true);
    getOrgMembers(currentOrg.organization_id)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    setSignalDefsLoading(true);
    getSignalDefinitions()
      .then((defs) => setSignalDefs(defs.filter((d) => d.scope === "global")))
      .catch(() => setSignalDefs([]))
      .finally(() => setSignalDefsLoading(false));
  }, [currentOrg]);

  useEffect(() => {
    if (!currentOrg) return;
    setCompaniesLoading(true);
    getCompanies()
      .then((data) => setCompanies(data.companies))
      .catch(() => setCompanies([]))
      .finally(() => setCompaniesLoading(false));
  }, [currentOrg]);

  const currentUserRole = members.find((m) => m.user_id === user?.id)?.role;
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const handleFrequencyChange = async (freq: EmailFrequency) => {
    setFrequencyState(freq);
    try {
      await setEmailFrequency(freq);
    } catch {}
  };

  const handleInvite = async () => {
    if (!currentOrg || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError(null);
    setInviteSuccess(null);
    try {
      const result = await inviteMember(
        currentOrg.organization_id,
        inviteEmail.trim(),
        inviteRole,
      );
      if (!result.success && result.error) {
        setInviteError(result.error);
      } else {
        setInviteSuccess(result.message ?? `Invited ${inviteEmail.trim()}`);
        setInviteEmail("");
        const updated = await getOrgMembers(currentOrg.organization_id);
        setMembers(updated);
      }
    } catch (err) {
      setInviteError((err as Error).message ?? "Failed to invite member");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentOrg) return;
    try {
      await removeMember(currentOrg.organization_id, userId);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {
    } finally {
      setRemoveMemberId(null);
    }
  };

  const handleCancelInvite = async (invitationId: string) => {
    if (!currentOrg) return;
    try {
      await cancelInvitation(currentOrg.organization_id, invitationId);
      setMembers((prev) => prev.filter((m) => m.id !== invitationId));
    } catch {
    } finally {
      setCancelInviteId(null);
    }
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    setCreateOrgLoading(true);
    setCreateOrgError(null);
    try {
      const org = await createOrganization(newOrgName.trim());
      await refreshOrgs();
      setCurrentOrg(org);
      setNewOrgName("");
      setShowCreateOrgDialog(false);
    } catch (err) {
      setCreateOrgError((err as Error).message ?? "Failed to create organization");
    } finally {
      setCreateOrgLoading(false);
    }
  };

  const handleToggleSignal = async (def: SignalDefinition) => {
    try {
      const updated = await toggleSignalDefinition(def.id, !def.enabled);
      setSignalDefs((prev) => prev.map((d) => (d.id === def.id ? updated : d)));
    } catch {}
  };

  const handleDeleteSignal = async (id: string) => {
    try {
      await deleteSignalDefinition(id);
      setSignalDefs((prev) => prev.filter((d) => d.id !== id));
    } catch {
    } finally {
      setDeleteSignalId(null);
    }
  };

  const openEditSignal = (def: SignalDefinition) => {
    setEditingDef(def);
    setSignalForm({
      name: def.name,
      display_name: def.display_name,
      signal_type: def.signal_type,
      target_url: def.target_url,
      search_instructions: def.search_instructions,
      scope: def.scope ?? "global",
      company_id: def.company_id ?? null,
    });
    setSignalFormError(null);
    setSignalDialogOpen(true);
  };

  const openNewSignal = () => {
    setEditingDef(undefined);
    setSignalForm({ ...EMPTY_SIGNAL_FORM });
    setSignalFormError(null);
    setSignalDialogOpen(true);
  };

  const handleSignalNameChange = (value: string) => {
    setSignalForm((prev) => ({
      ...prev,
      name: value,
      display_name: value,
      signal_type: editingDef ? prev.signal_type : slugify(value),
    }));
  };

  const handleSaveSignal = async () => {
    const { name, signal_type, display_name, target_url, search_instructions, scope, company_id } =
      signalForm;
    if (!name || !signal_type || !display_name || !target_url || !search_instructions) {
      setSignalFormError("All fields are required.");
      return;
    }
    if (scope === "company" && !company_id) {
      setSignalFormError("Please select a company for company-scoped signals.");
      return;
    }
    setSignalFormSaving(true);
    setSignalFormError(null);
    try {
      if (editingDef) {
        const updated = await updateSignalDefinition(editingDef.id, {
          ...signalForm,
          scope,
          company_id,
        });
        setSignalDefs((prev) =>
          prev.map((d) => (d.id === editingDef.id ? updated : d)),
        );
      } else {
        const created = await createSignalDefinition({
          ...signalForm,
          scope,
          company_id,
        });
        setSignalDefs((prev) => [...prev, created]);
      }
      setSignalDialogOpen(false);
    } catch (err) {
      setSignalFormError(
        (err as Error).message ?? "Failed to save signal definition.",
      );
    } finally {
      setSignalFormSaving(false);
    }
  };

  const currentSlug = editingDef ? signalForm.signal_type : slugify(signalForm.name);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Tabs defaultValue="email">
        <TabsList>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Email</CardTitle>
              <CardDescription>
                Intelligence reports will be sent to your account email.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-sm space-y-2">
                <Label htmlFor="email-display">Email Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="email-display"
                    value={deliveryEmail}
                    onChange={(e) => setDeliveryEmail(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSaveEmail}
                    disabled={isSavingEmail || !deliveryEmail.trim()}
                  >
                    {isSavingEmail ? "Saving..." : "Save"}
                  </Button>
                </div>
                {emailError && (
                  <p className="text-sm text-destructive">{emailError}</p>
                )}
                {emailSuccess && (
                  <p className="text-sm text-green-600">{emailSuccess}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Reports will be sent to this email address.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Frequency</CardTitle>
              <CardDescription>
                How often should intelligence agents automatically run and send
                reports?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs">
                <Label htmlFor="frequency-select" className="sr-only">
                  Report frequency
                </Label>
                <Select
                  value={frequency}
                  onValueChange={(v) =>
                    handleFrequencyChange(v as EmailFrequency)
                  }
                >
                  <SelectTrigger id="frequency-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label} — {opt.desc}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="signals" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Global Signals</CardTitle>
                <CardDescription className="mt-1">
                  Configure org-wide intelligence signals. These run for all
                  companies by default.
                </CardDescription>
              </div>
              {canManage && (
                <Button size="sm" onClick={openNewSignal}>
                  <PlusIcon className="mr-1 h-4 w-4" />
                  New Signal
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {signalDefsLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <Skeleton key={n} className="h-10 w-full" />
                  ))}
                </div>
              ) : signalDefs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No global signal definitions yet. They will be auto-created on
                  your next login.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Enabled</TableHead>
                      {canManage && (
                        <TableHead className="text-right">Actions</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signalDefs.map((def) => (
                      <TableRow
                        key={def.id}
                        className={def.enabled ? "" : "opacity-50"}
                      >
                        <TableCell className="font-medium">{def.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {def.signal_type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={def.enabled}
                            onCheckedChange={() =>
                              canManage && handleToggleSignal(def)
                            }
                            disabled={!canManage}
                            aria-label={`Toggle ${def.name}`}
                          />
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Edit ${def.name}`}
                                onClick={() => openEditSignal(def)}
                              >
                                <PencilIcon className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={`Delete ${def.name}`}
                                onClick={() => setDeleteSignalId(def.id)}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organization" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">Organizations</CardTitle>
                <CardDescription className="mt-1">
                  Switch between your organizations.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowCreateOrgDialog(true)}
              >
                <PlusIcon className="mr-1 h-4 w-4" />
                New Org
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {organizations.map((org) => {
                  const isActive =
                    currentOrg?.organization_id === org.organization_id;
                  return (
                    <button
                      key={org.organization_id}
                      type="button"
                      disabled={isActive}
                      onClick={() => setCurrentOrg(org)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors text-left ${
                        isActive
                          ? "border-primary bg-primary/5 cursor-default"
                          : "cursor-pointer hover:bg-muted"
                      }`}
                    >
                      <span className="font-medium">{org.name}</span>
                      {isActive && <Badge variant="secondary">Active</Badge>}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {currentOrg && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Members of {currentOrg.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {membersLoading ? (
                  <div className="space-y-2">
                    {[1, 2].map((n) => (
                      <Skeleton key={n} className="h-10 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        {canManage && (
                          <TableHead className="text-right">Actions</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((m) => {
                        const isPending = m.status === "pending";
                        return (
                          <TableRow
                            key={m.id}
                            className={isPending ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {m.email ?? m.user_id}
                                {isPending && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] border-amber-400 text-amber-600"
                                  >
                                    Pending
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  m.role === "owner"
                                    ? "default"
                                    : m.role === "admin"
                                      ? "secondary"
                                      : "outline"
                                }
                              >
                                {ROLE_LABELS[m.role] ?? m.role}
                              </Badge>
                            </TableCell>
                            {canManage && (
                              <TableCell className="text-right">
                                {isPending ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-muted-foreground hover:text-destructive"
                                    aria-label={`Cancel invitation for ${m.email}`}
                                    onClick={() => setCancelInviteId(m.id)}
                                  >
                                    Cancel
                                  </Button>
                                ) : (
                                  isOwner && m.role !== "owner" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-destructive hover:text-destructive"
                                      aria-label={`Remove ${m.email ?? m.user_id}`}
                                      onClick={() => m.user_id && setRemoveMemberId(m.user_id)}
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </Button>
                                  )
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                {canManage && (
                  <div className="space-y-2 pt-2">
                    <Label className="text-sm font-medium">
                      Invite New Member
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                        className="flex-1"
                        aria-label="Invite email address"
                      />
                      <Select
                        value={inviteRole}
                        onValueChange={(v) =>
                          setInviteRole(v as "member" | "admin")
                        }
                      >
                        <SelectTrigger className="w-28" aria-label="Invite role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        onClick={handleInvite}
                        disabled={inviteLoading || !inviteEmail.trim()}
                      >
                        {inviteLoading ? "Inviting..." : "Invite"}
                      </Button>
                    </div>
                    {inviteError && (
                      <p className="text-sm text-destructive">{inviteError}</p>
                    )}
                    {inviteSuccess && (
                      <p className="text-sm text-green-600">{inviteSuccess}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog
        open={signalDialogOpen}
        onOpenChange={(open) => setSignalDialogOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDef ? "Edit Signal" : "New Signal"}
            </DialogTitle>
            <DialogDescription>
              Configure what the intelligence agent should look for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signal-scope">Scope</Label>
              <Select
                value={signalForm.scope}
                onValueChange={(v) =>
                  setSignalForm((p) => ({
                    ...p,
                    scope: v as "global" | "company",
                    company_id: v === "global" ? null : p.company_id,
                  }))
                }
              >
                <SelectTrigger id="signal-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="company">Company-Specific</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {signalForm.scope === "company" && (
              <div className="space-y-1.5">
                <Label htmlFor="signal-company">Company</Label>
                <Select
                  value={signalForm.company_id ?? ""}
                  onValueChange={(v) =>
                    setSignalForm((p) => ({ ...p, company_id: v || null }))
                  }
                >
                  <SelectTrigger id="signal-company">
                    <SelectValue placeholder="Select a company" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.company_id} value={c.company_id}>
                        {c.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="signal-name">Name</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="signal-name"
                  placeholder="e.g. Patent Filings"
                  value={signalForm.name}
                  onChange={(e) => handleSignalNameChange(e.target.value)}
                  className="flex-1"
                />
                {currentSlug && (
                  <Badge variant="outline" className="shrink-0 font-mono text-xs">
                    {currentSlug}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signal-url">
                Target URL
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Supports: {"{website_url}"}, {"{company_name}"}, etc.
                </span>
              </Label>
              <Input
                id="signal-url"
                placeholder="e.g. {website_url} or https://news.google.com"
                value={signalForm.target_url}
                onChange={(e) =>
                  setSignalForm((p) => ({ ...p, target_url: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signal-instructions">What to look for</Label>
              <Textarea
                id="signal-instructions"
                placeholder="Describe what the agent should search for..."
                value={signalForm.search_instructions}
                onChange={(e) =>
                  setSignalForm((p) => ({
                    ...p,
                    search_instructions: e.target.value,
                  }))
                }
                rows={4}
              />
            </div>
            {signalFormError && (
              <p className="text-sm text-destructive">{signalFormError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSignalDialogOpen(false)}
              disabled={signalFormSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveSignal} disabled={signalFormSaving}>
              {signalFormSaving
                ? "Saving..."
                : editingDef
                  ? "Save Changes"
                  : "Create Signal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteSignalId}
        onOpenChange={(open) => {
          if (!open) setDeleteSignalId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Signal?</AlertDialogTitle>
            <AlertDialogDescription>
              This signal definition will be permanently deleted. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteSignalId && handleDeleteSignal(deleteSignalId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!cancelInviteId}
        onOpenChange={(open) => {
          if (!open) setCancelInviteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the pending invitation. The invite link will no longer work.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => cancelInviteId && handleCancelInvite(cancelInviteId)}
            >
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!removeMemberId}
        onOpenChange={(open) => {
          if (!open) setRemoveMemberId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member?</AlertDialogTitle>
            <AlertDialogDescription>
              This member will be removed from the organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => removeMemberId && handleRemoveMember(removeMemberId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={showCreateOrgDialog}
        onOpenChange={(open) => setShowCreateOrgDialog(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Organization</DialogTitle>
            <DialogDescription>
              Create a new organization to manage companies and team members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization Name</Label>
            <Input
              id="org-name"
              placeholder="e.g. Acme Corp"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
            />
            {createOrgError && (
              <p className="text-sm text-destructive">{createOrgError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateOrgDialog(false);
                setNewOrgName("");
                setCreateOrgError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateOrg}
              disabled={createOrgLoading || !newOrgName.trim()}
            >
              {createOrgLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
