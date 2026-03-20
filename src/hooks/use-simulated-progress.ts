import { useEffect, useRef, useState } from "react";

export type AgentStatus = "connecting" | "browsing" | "analyzing" | "complete" | "error";

type Phase = "simulating" | "completing" | "frozen";

const DURATION_MS = 480_000; // 8 minutes
const TICK_MS = 250;
const MAX_SIMULATED = 90;
const COMPLETION_MS = 1_500;

function baseProgress(elapsed: number): number {
  const t = Math.min(elapsed / DURATION_MS, 1);
  return MAX_SIMULATED * (1 - Math.pow(1 - t, 2.5));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Deterministic seeded random from agentId + tick index.
 * Produces a repeatable jitter sequence so remounting at the same
 * elapsed time yields the same accumulated offset.
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

function computeJitterOffset(agentSeed: number, tickCount: number): number {
  let offset = 0;
  for (let i = 0; i < tickCount; i++) {
    offset += seededRandom(agentSeed + i) * 0.6 - 0.3;
    offset = clamp(offset, -1.5, 1.5);
  }
  return offset;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function useSimulatedProgress(
  status: AgentStatus,
  startedAt: number,
  agentId?: string,
): number {
  const seed = useRef(agentId ? hashString(agentId) : Math.random() * 100000);

  const [progress, setProgress] = useState(() => {
    if (status === "complete") return 100;
    if (status === "error") return 0;
    // Compute initial value from elapsed time so remount picks up where it left off
    const elapsed = Date.now() - startedAt;
    const tickCount = Math.floor(elapsed / TICK_MS);
    const base = baseProgress(elapsed);
    const jitter = computeJitterOffset(seed.current, tickCount);
    return Math.round(clamp(base + jitter, 0, MAX_SIMULATED));
  });

  const phaseRef = useRef<Phase>(
    status === "complete" ? "frozen" : status === "error" ? "frozen" : "simulating",
  );
  const completionStart = useRef<{ time: number; from: number } | null>(null);
  const jitterOffset = useRef(0);

  useEffect(() => {
    if (status === "complete" && phaseRef.current === "simulating") {
      phaseRef.current = "completing";
      completionStart.current = { time: Date.now(), from: progress };
    } else if (status === "error" && phaseRef.current === "simulating") {
      phaseRef.current = "frozen";
    }
  }, [status, progress]);

  useEffect(() => {
    if (phaseRef.current === "frozen" && status !== "complete" && status !== "error") {
      phaseRef.current = "simulating";
    }

    const id = setInterval(() => {
      const phase = phaseRef.current;

      if (phase === "frozen") return;

      if (phase === "simulating") {
        const elapsed = Date.now() - startedAt;
        const base = baseProgress(elapsed);

        // Drift jitter (non-deterministic during live ticking — only matters for smoothness)
        jitterOffset.current = clamp(
          jitterOffset.current + Math.random() * 0.6 - 0.3,
          -1.5,
          1.5,
        );

        setProgress(Math.round(clamp(base + jitterOffset.current, 0, MAX_SIMULATED)));
      } else if (phase === "completing") {
        const cs = completionStart.current!;
        const elapsed = Date.now() - cs.time;
        const t = Math.min(elapsed / COMPLETION_MS, 1);
        const value = cs.from + (100 - cs.from) * t;
        setProgress(Math.round(value));

        if (t >= 1) {
          phaseRef.current = "frozen";
          setProgress(100);
        }
      }
    }, TICK_MS);

    return () => clearInterval(id);
  }, [status, startedAt]);

  return progress;
}

interface AgentTracker {
  startTime: number;
  phase: Phase;
  jitterOffset: number;
  completionStart: { time: number; from: number } | null;
  progress: number;
}

/**
 * Tracks simulated progress for multiple agents and returns their average.
 * Each agent is identified by its id; new agents are picked up automatically.
 */
export function useAggregateSimulatedProgress(
  agents: { agentId: string; status: AgentStatus }[],
  startedAt: number,
): number {
  const trackersRef = useRef<Map<string, AgentTracker>>(new Map());
  const [aggregate, setAggregate] = useState(() => {
    // Compute initial aggregate from elapsed time
    if (agents.length === 0) return 0;
    const elapsed = Date.now() - startedAt;
    let sum = 0;
    for (const agent of agents) {
      if (agent.status === "complete") { sum += 100; continue; }
      if (agent.status === "error") continue;
      sum += Math.round(clamp(baseProgress(elapsed), 0, MAX_SIMULATED));
    }
    return Math.round(sum / agents.length);
  });

  // Sync trackers with current agent list
  useEffect(() => {
    const trackers = trackersRef.current;
    for (const agent of agents) {
      let tracker = trackers.get(agent.agentId);
      if (!tracker) {
        tracker = {
          startTime: startedAt,
          phase:
            agent.status === "complete" || agent.status === "error"
              ? "frozen"
              : "simulating",
          jitterOffset: 0,
          completionStart: null,
          progress: agent.status === "complete" ? 100 : 0,
        };
        trackers.set(agent.agentId, tracker);
      }

      // Handle status transitions
      if (agent.status === "complete" && tracker.phase === "simulating") {
        tracker.phase = "completing";
        tracker.completionStart = { time: Date.now(), from: tracker.progress };
      } else if (agent.status === "error" && tracker.phase === "simulating") {
        tracker.phase = "frozen";
      }
    }
  }, [agents, startedAt]);

  useEffect(() => {
    const id = setInterval(() => {
      const trackers = trackersRef.current;
      if (trackers.size === 0) return;

      for (const tracker of trackers.values()) {
        if (tracker.phase === "frozen") continue;

        if (tracker.phase === "simulating") {
          const elapsed = Date.now() - tracker.startTime;
          const base = baseProgress(elapsed);
          tracker.jitterOffset = clamp(
            tracker.jitterOffset + Math.random() * 0.6 - 0.3,
            -1.5,
            1.5,
          );
          tracker.progress = Math.round(
            clamp(base + tracker.jitterOffset, 0, MAX_SIMULATED),
          );
        } else if (tracker.phase === "completing") {
          const cs = tracker.completionStart!;
          const elapsed = Date.now() - cs.time;
          const t = Math.min(elapsed / COMPLETION_MS, 1);
          tracker.progress = Math.round(cs.from + (100 - cs.from) * t);
          if (t >= 1) {
            tracker.phase = "frozen";
            tracker.progress = 100;
          }
        }
      }

      let sum = 0;
      for (const tracker of trackers.values()) sum += tracker.progress;
      setAggregate(Math.round(sum / trackers.size));
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  return aggregate;
}
