"use client";

import { useState } from "react";
import Link from "next/link";
import { Square, X, CheckCircle2, Zap } from "lucide-react";
import { useRuns } from "@/lib/context/RunsContext";
import { AgentCard } from "@/components/AgentCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function ActiveRunsPage() {
  const { activeRuns, handleStopRun, handleDismissRun, handleRemoveQueued } =
    useRuns();

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    activeRuns[0]?.companyId ?? null,
  );

  const selectedRun =
    activeRuns.find((r) => r.companyId === selectedCompanyId) ?? null;

  const handleSelectRun = (companyId: string) => {
    setSelectedCompanyId(companyId);
  };

  const handleDismiss = (companyId: string) => {
    handleDismissRun(companyId);
    const remaining = activeRuns.filter((r) => r.companyId !== companyId);
    setSelectedCompanyId(remaining[0]?.companyId ?? null);
  };

  const handleRemove = (companyId: string) => {
    handleRemoveQueued(companyId);
    const remaining = activeRuns.filter((r) => r.companyId !== companyId);
    setSelectedCompanyId(remaining[0]?.companyId ?? null);
  };

  if (activeRuns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border bg-muted/30 py-24 text-center">
        <Zap className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">No Active Runs</p>
        <p className="text-xs text-muted-foreground">
          Go to{" "}
          <Link href="/companies" className="underline underline-offset-2">
            Companies
          </Link>{" "}
          and click &ldquo;Run Agents&rdquo; to launch intelligence agents.
        </p>
      </div>
    );
  }

  const completedAgents =
    selectedRun?.agents.filter((a) => a.status === "complete").length ?? 0;
  const totalAgents = selectedRun?.agents.length ?? 0;
  const progressPct =
    totalAgents > 0 ? Math.round((completedAgents / totalAgents) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Active Runs</h1>
        <p className="text-sm text-muted-foreground">
          {activeRuns.filter((r) => !r.isComplete).length} running ·{" "}
          {activeRuns.filter((r) => r.isComplete).length} complete
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {activeRuns.map((run) => {
          const done = run.agents.filter((a) => a.status === "complete").length;
          const total = run.agents.length;
          const isSelected = selectedCompanyId === run.companyId;

          return (
            <button
              key={run.companyId}
              type="button"
              onClick={() => handleSelectRun(run.companyId)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-border",
              )}
            >
              {!run.isComplete && !run.queued && (
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current opacity-70" />
              )}
              <span>{run.companyName}</span>
              {run.queued ? (
                <Badge variant="outline" className="text-[10px]">
                  Queued
                </Badge>
              ) : total > 0 ? (
                <span className="text-xs opacity-70">
                  {done}/{total}
                </span>
              ) : null}
              {run.isComplete && (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              )}
            </button>
          );
        })}
      </div>

      {selectedRun ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">
              {selectedRun.companyName}
            </span>
            <div className="flex items-center gap-2">
              {selectedRun.queued && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRemove(selectedRun.companyId)}
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </Button>
              )}
              {!selectedRun.isComplete && !selectedRun.queued && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleStopRun(selectedRun.companyId)}
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              )}
              {selectedRun.isComplete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDismiss(selectedRun.companyId)}
                >
                  Dismiss
                </Button>
              )}
            </div>
          </div>

          {selectedRun.emailSent && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Report email sent (check spam and updates folders)
            </div>
          )}

          {!selectedRun.isComplete && totalAgents > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {completedAgents}/{totalAgents} agents complete
                </span>
                <span>{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-1.5" />
            </div>
          )}

          {selectedRun.agents.length === 0 && !selectedRun.isComplete && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-12 text-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-xs text-muted-foreground">
                {selectedRun.queued
                  ? "Queued — waiting for a slot..."
                  : "Launching agents..."}
              </p>
            </div>
          )}

          {selectedRun.agents.length === 0 && !selectedRun.isComplete && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {["sk1", "sk2", "sk3", "sk4", "sk5"].map((k) => (
                <div
                  key={k}
                  className="flex flex-col gap-3 rounded-xl border p-4"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="aspect-video w-full rounded-md" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {selectedRun.agents.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {selectedRun.agents.map((agent) => (
                <AgentCard key={agent.agentId} agent={agent} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Select a run above to view agent activity.
          </p>
        </div>
      )}
    </div>
  );
}
