"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitation, getInvitationDetails } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";

type Status = "loading" | "preview" | "accepting" | "success" | "error";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading, refreshOrgs } = useAuth();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");
  const [inviterEmail, setInviterEmail] = useState<string>("");

  useEffect(() => {
    if (authLoading) return;

    if (!token) {
      setStatus("error");
      setMessage("Invalid invitation link — no token found.");
      return;
    }

    if (!user) {
      router.push(`/login?redirect=/invite/accept?token=${token}`);
      return;
    }

    getInvitationDetails(token)
      .then((details) => {
        setOrgName(details.organization_name ?? "");
        setInviterEmail(details.invited_by_email ?? "");
        setStatus("preview");
      })
      .catch((err: Error) => {
        setStatus("error");
        setMessage(err.message || "Failed to load invitation details.");
      });
  }, [user, authLoading, token, router]);

  const handleAccept = async () => {
    if (!token) return;
    setStatus("accepting");
    try {
      const result = await acceptInvitation(token);
      if (result.success) {
        setOrgName(result.organization_name ?? orgName);
        setStatus("success");
        await refreshOrgs();
      } else {
        setStatus("error");
        setMessage(result.error ?? "Failed to accept invitation.");
      }
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  };

  if (status === "loading" || status === "accepting") {
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
            {status === "preview" && (
              <>
                <CardTitle>You&apos;ve been invited</CardTitle>
                <CardDescription>
                  Join <strong>{orgName || "an organization"}</strong>
                  {inviterEmail ? <> — invited by <strong>{inviterEmail}</strong></> : null}
                </CardDescription>
              </>
            )}
            {status === "success" && (
              <>
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-2" />
                <CardTitle>You&apos;re in!</CardTitle>
                <CardDescription>
                  You&apos;ve joined {orgName || "the organization"}.
                </CardDescription>
              </>
            )}
            {status === "error" && (
              <>
                <XCircle className="mx-auto h-12 w-12 text-destructive mb-2" />
                <CardTitle>Invitation Error</CardTitle>
              </>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {status === "preview" && (
              <>
                <Button onClick={handleAccept} className="w-full" type="button">
                  Accept Invitation
                </Button>
                <Button variant="outline" onClick={() => router.push("/")} className="w-full" type="button">
                  Go Home
                </Button>
              </>
            )}
            {status === "error" && (
              <>
                <Alert variant="destructive">
                  <AlertDescription>{message}</AlertDescription>
                </Alert>
                <Button onClick={() => router.push("/")} className="w-full" type="button">
                  Go Home
                </Button>
              </>
            )}
            {status === "success" && (
              <Button onClick={() => router.push("/")} className="w-full" type="button">
                Go to Dashboard
              </Button>
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
