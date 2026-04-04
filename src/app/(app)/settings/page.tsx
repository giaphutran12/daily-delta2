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
  type EmailFrequency,
} from "@/lib/api/client";
import { toast } from "sonner";
import type { OrganizationMember } from "@/lib/types";
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
import { PlusIcon, TrashIcon } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const FREQUENCY_OPTIONS: Array<{
  value: EmailFrequency;
  label: string;
  desc: string;
}> = [
  { value: "daily", label: "Daily", desc: "Every day" },
  { value: "every_3_days", label: "Every 3 days", desc: "Once every 3 days" },
  { value: "weekly", label: "Weekly", desc: "Once a week" },
  { value: "monthly", label: "Monthly", desc: "Once a month" },
];

export default function SettingsPage() {
  const { user, currentOrg, organizations, setCurrentOrg, refreshOrgs } =
    useAuth();

  const [frequency, setFrequencyState] = useState<EmailFrequency>("daily");
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
  const [cancelInviteError, setCancelInviteError] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState("");
  const [createOrgLoading, setCreateOrgLoading] = useState(false);
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);

  const [removeMemberId, setRemoveMemberId] = useState<string | null>(null);
  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);

  useEffect(() => {
    getUserSettings()
      .then((s) => {
        if (s.email) setDeliveryEmail(s.email);
        else if (user?.email) setDeliveryEmail(user.email);
        setFrequencyState(s.email_frequency ?? "daily");
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      });
  }, [user?.email]);

  const handleSaveEmail = async () => {
    if (!deliveryEmail.trim()) return;
    setIsSavingEmail(true);
    setEmailError(null);
    setEmailSuccess(null);
    try {
      await setEmail(deliveryEmail.trim());
      const settings = await getUserSettings();
      setDeliveryEmail(settings.email ?? deliveryEmail.trim());
      setFrequencyState(settings.email_frequency ?? frequency);
      setEmailSuccess("Delivery email updated successfully.");
    } catch (err) {
      setEmailError((err as Error).message ?? "Failed to update email.");
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handleFrequencyChange = async (freq: EmailFrequency) => {
    const previous = frequency;
    setFrequencyState(freq);
    try {
      await setEmailFrequency(freq);
      const settings = await getUserSettings();
      setFrequencyState(settings.email_frequency ?? freq);
    } catch (err) {
      setFrequencyState(previous);
      toast.error(err instanceof Error ? err.message : "Failed to update frequency");
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

  const currentUserRole = members.find((m) => m.user_id === user?.id)?.role;
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemoveMemberId(null);
    }
  };

  const handleCancelInvite = async (invitationId: string) => {
    if (!currentOrg) return;
    setCancelInviteError(null);
    try {
      await cancelInvitation(currentOrg.organization_id, invitationId);
      setMembers((prev) => prev.filter((m) => m.id !== invitationId));
    } catch (err) {
      console.error('[SETTINGS] Failed to cancel invite:', err);
      setCancelInviteError((err as Error).message || "Failed to cancel invitation");
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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Tabs defaultValue="email">
        <TabsList>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
        </TabsList>

        <TabsContent value="email" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Report Email</CardTitle>
              <CardDescription>
                Intelligence reports will be sent to your chosen delivery email.
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
              <div className="mt-6 max-w-sm space-y-2">
                <Label htmlFor="email-frequency">Email Frequency</Label>
                <Select
                  value={frequency}
                  onValueChange={(value) =>
                    void handleFrequencyChange(value as EmailFrequency)
                  }
                >
                  <SelectTrigger id="email-frequency">
                    <SelectValue placeholder="Select delivery frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {
                    FREQUENCY_OPTIONS.find((option) => option.value === frequency)
                      ?.desc
                  }
                </p>
              </div>
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
                  <div className="overflow-x-auto">
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
                  </div>
                 )}

                 {cancelInviteError && (
                   <p className="text-sm text-destructive">{cancelInviteError}</p>
                 )}

                 {canManage && (
                   <div className="space-y-2 pt-2">
                    <Label className="text-sm font-medium">
                      Invite New Member
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="email"
                        placeholder="user@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                        className="flex-1"
                        aria-label="Invite email address"
                      />
                      <div className="flex gap-2">
                        <Select
                          value={inviteRole}
                          onValueChange={(v) =>
                            setInviteRole(v as "member" | "admin")
                          }
                        >
                          <SelectTrigger className="w-28 shrink-0" aria-label="Invite role">
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
