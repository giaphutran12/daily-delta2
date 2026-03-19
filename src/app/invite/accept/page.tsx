"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { acceptInvitation } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/AuthContext";

type Status = "loading" | "success" | "error";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading, refreshOrgs } = useAuth();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");
  const [orgName, setOrgName] = useState<string>("");

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

    acceptInvitation(token)
      .then(async (result) => {
        if (result.success) {
          setOrgName(result.organization_name ?? "");
          setStatus("success");
          await refreshOrgs();
        } else {
          setStatus("error");
          setMessage(result.error ?? "Failed to accept invitation.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      });
  }, [user, authLoading, token, router, refreshOrgs]);

  if (status === "loading") {
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
            {status === "success" ? (
              <>
                <CheckCircle2 className="mx-auto h-12 w-12 text-green-500 mb-2" />
                <CardTitle>You&apos;re in!</CardTitle>
                <CardDescription>
                  You&apos;ve joined {orgName || "the organization"}.
                </CardDescription>
              </>
            ) : (
              <>
                <XCircle className="mx-auto h-12 w-12 text-destructive mb-2" />
                <CardTitle>Invitation Error</CardTitle>
              </>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {status === "error" && (
              <Alert variant="destructive">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            <Button onClick={() => router.push("/")} className="w-full">
              {status === "success" ? "Go to Dashboard" : "Go Home"}
            </Button>
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
