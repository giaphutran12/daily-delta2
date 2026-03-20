"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useSimulatedProgress } from "@/hooks/use-simulated-progress";
import type { AgentState } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agent: AgentState;
  startedAt: number;
}

const STATUS_LABELS: Record<string, string> = {
  connecting: "Connecting",
  browsing: "Browsing",
  analyzing: "Analyzing",
  complete: "Complete",
  error: "Error",
};

function getStatusVariant(
  status: AgentState["status"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "secondary";
    case "error":
      return "destructive";
    case "browsing":
    case "analyzing":
      return "default";
    default:
      return "outline";
  }
}

function StatusDot({ status }: { status: AgentState["status"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "connecting" && "bg-muted-foreground animate-pulse",
        status === "browsing" && "bg-primary animate-pulse",
        status === "analyzing" && "bg-primary animate-pulse",
        status === "complete" && "bg-green-500",
        status === "error" && "bg-destructive",
      )}
    />
  );
}

export function AgentCard({ agent, startedAt }: AgentCardProps) {
  const isActive =
    agent.status === "browsing" ||
    agent.status === "analyzing" ||
    agent.status === "connecting";
  const signalCount = agent.findings?.signals?.length ?? 0;
  const progress = useSimulatedProgress(agent.status, startedAt, agent.agentId);

  return (
    <Card
      className={cn(
        "flex flex-col gap-0 overflow-hidden transition-shadow",
        agent.status === "complete" && "ring-green-500/30",
        agent.status === "error" && "ring-destructive/30",
      )}
    >
      <CardHeader className="border-b pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <StatusDot status={agent.status} />
            <CardTitle className="text-sm truncate">{agent.agentName}</CardTitle>
          </div>
          <Badge variant={getStatusVariant(agent.status)} className="shrink-0">
            {STATUS_LABELS[agent.status] ?? agent.status}
          </Badge>
        </div>
      </CardHeader>

      <Progress value={progress} className="h-1 [&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:rounded-none" />

      <CardContent className="flex flex-col gap-3 pt-3">
        {agent.streamingUrl && isActive && (
          <div className="flex flex-col gap-1.5">
            <div className="relative w-full overflow-hidden rounded-md border bg-muted aspect-video">
              <iframe
                src={agent.streamingUrl}
                title={`Live: ${agent.agentName}`}
                sandbox="allow-scripts allow-same-origin"
                className="absolute inset-0 h-full w-full"
              />
              <div className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                LIVE
              </div>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {agent.streamingUrl}
            </p>
          </div>
        )}

        {agent.status === "connecting" && !agent.streamingUrl && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-32 w-full rounded-md" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        )}

        {agent.message && isActive && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {agent.message}
          </p>
        )}

        {agent.status === "complete" && (
          <div className="flex flex-col gap-1.5">
            <p
              className={cn(
                "text-xs font-medium",
                signalCount > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
              )}
            >
              {signalCount > 0
                ? `${signalCount} signal${signalCount !== 1 ? "s" : ""} detected`
                : "0 results found"}
            </p>
            {agent.findings?.signals?.slice(0, 3).map((s) => (
              <div
                key={`${s.signal_type}-${s.title}`}
                className="flex items-start gap-1.5 rounded-md border bg-muted/50 px-2 py-1.5"
              >
                <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-medium text-primary">
                  {s.signal_type.replace(/_/g, " ")}
                </span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {s.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {agent.status === "error" && agent.error && (
          <p className="text-xs text-destructive line-clamp-3">{agent.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
