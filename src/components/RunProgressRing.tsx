"use client";

import { useAggregateSimulatedProgress } from "@/hooks/use-simulated-progress";
import type { ActiveRun } from "@/lib/api/client";

const SIZE = 24;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface RunProgressRingProps {
  run: ActiveRun;
  onClick?: () => void;
}

export function RunProgressRing({ run, onClick }: RunProgressRingProps) {
  const agents = run.agents.map((a) => ({
    agentId: a.agentId,
    status: a.status,
  }));
  const progress = useAggregateSimulatedProgress(agents, run.startedAt);
  const offset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE;

  return (
    <div
      className={`flex items-center gap-1.5${onClick ? " cursor-pointer" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          className="text-muted/60"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-primary transition-all duration-200"
        />
      </svg>
      <span className="text-xs tabular-nums font-medium text-muted-foreground">
        {progress}%
      </span>
    </div>
  );
}
