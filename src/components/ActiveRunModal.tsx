"use client";

import { Square, X, CheckCircle2, Minimize2 } from "lucide-react";
import { useRuns } from "@/lib/context/RunsContext";
import { AgentCard } from "@/components/AgentCard";
import { useAggregateSimulatedProgress } from "@/hooks/use-simulated-progress";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ActiveRunModalProps {
  companyId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function ActiveRunModal({ companyId, onOpenChange }: ActiveRunModalProps) {
  const { activeRuns, handleStopRun, handleDismissRun, handleRemoveQueued } =
    useRuns();

  const open = companyId !== null;
  const selectedRun =
    activeRuns.find((r) => r.companyId === companyId) ?? null;

  const totalAgents = selectedRun?.agents.length ?? 0;
  const runStartedAt = selectedRun?.startedAt ?? Date.now();
  const agentsForProgress = selectedRun?.agents.map((a) => ({
    agentId: a.agentId,
    status: a.status,
  })) ?? [];
  const progressPct = useAggregateSimulatedProgress(agentsForProgress, runStartedAt);

  const handleDismiss = () => {
    if (companyId) {
      handleDismissRun(companyId);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] overflow-y-auto" showCloseButton={false}>
        {selectedRun ? (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>{selectedRun.companyName}</DialogTitle>
                <Button size="icon-sm" variant="ghost" onClick={() => onOpenChange(false)}>
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Minimize</span>
                </Button>
              </div>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-end gap-2">
                {selectedRun.queued && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      handleRemoveQueued(selectedRun.companyId);
                      onOpenChange(false);
                    }}
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
                  <Button size="sm" variant="outline" onClick={handleDismiss}>
                    Dismiss
                  </Button>
                )}
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
                      {totalAgents} agent{totalAgents !== 1 ? "s" : ""} running
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
                    <AgentCard key={agent.agentId} agent={agent} startedAt={runStartedAt} />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>Active Run</DialogTitle>
                <Button size="icon-sm" variant="ghost" onClick={() => onOpenChange(false)}>
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Minimize</span>
                </Button>
              </div>
            </DialogHeader>
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border bg-muted/30 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No active run for this company.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
