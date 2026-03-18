"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitation, getInvitationDetails } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const token = searchParams.get("token");

  const [orgName, setOrgName] = useState<string | null>(null);
  const [invitedByEmail, setInvitedByEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(true);

  useEffect(() => {
    if (!token) {
      setError("Invalid invite link — no token found.");
      setLoadingDetails(false);
      return;
    }
    getInvitationDetails(token)
      .then((data) => {
        setOrgName(data.organization_name ?? null);
        setInvitedByEmail(data.invited_by_email ?? null);
      })
      .catch(() => {
        setError("This invite link is invalid or has expired.");
      })
      .finally(() => setLoadingDetails(false));
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;

    if (!user) {
      router.push(`/login?redirect=/invite/accept?token=${token}`);
      return;
    }

    setAccepting(true);
    setError(null);

    const result = await acceptInvitation(token);
    if (result.success) {
      setSuccess(true);
      toast.success(`Joined ${result.organization_name ?? "organization"}`);
    } else {
      setError(result.error ?? "Failed to accept invitation. Please try again.");
    }
    setAccepting(false);
  };

  if (authLoading || loadingDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            {success ? (
              <>
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-2" />
                <CardTitle>You&apos;re in!</CardTitle>
                <CardDescription>
                  You&apos;ve joined {orgName ?? "the organization"}.
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle>You&apos;re invited</CardTitle>
                <CardDescription>
                  {orgName ? (
                    <>
                      Join <strong>{orgName}</strong> on Daily Delta
                      {invitedByEmail && <> — invited by {invitedByEmail}</>}
                    </>
                  ) : (
                    "Accept your invitation to Daily Delta"
                  )}
                </CardDescription>
              </>
            )}
          </CardHeader>

          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success ? (
              <Button onClick={() => router.push("/")} className="w-full">
                Go to Dashboard
              </Button>
            ) : (
              <>
                {!user && (
                  <Alert>
                    <AlertDescription>
                      You need to sign in or create an account to accept this invitation.
                    </AlertDescription>
                  </Alert>
                )}
                <Button onClick={handleAccept} className="w-full" disabled={accepting || !!error}>
                  {accepting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Accepting…
                    </>
                  ) : user ? (
                    "Accept Invitation"
                  ) : (
                    "Sign in to Accept"
                  )}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}
