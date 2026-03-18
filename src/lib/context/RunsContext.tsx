"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  runAgentsSSE,
  stopRun,
  type Company,
  type AgentState,
} from "@/lib/api/client";
import type { ReportData } from "@/lib/types";

export interface ActiveRun {
  companyId: string;
  companyName: string;
  agents: AgentState[];
  isComplete: boolean;
  liveReport: ReportData | null;
  emailSent?: boolean;
  startedAt: number;
  queued?: boolean;
}

interface QueueEntry {
  company: Company;
}

interface RunsContextType {
  activeRuns: ActiveRun[];
  handleRunCompany: (company: Company) => void;
  handleStopRun: (companyId: string) => Promise<void>;
  handleDismissRun: (companyId: string) => void;
  handleRemoveQueued: (companyId: string) => void;
}

const RunsContext = createContext<RunsContextType | undefined>(undefined);

const MAX_CONCURRENT_RUNS = 2;

export function RunsProvider({ children }: { children: ReactNode }) {
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>([]);
  const activeRunsRef = useRef<ActiveRun[]>([]);
  activeRunsRef.current = activeRuns;

  const runQueueRef = useRef<QueueEntry[]>([]);
  const runningCountRef = useRef(0);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const processQueueRef = useRef<() => void>(() => {});

  const executeRun = useCallback((company: Company) => {
    runningCountRef.current++;

    setActiveRuns((prev) =>
      prev.map((r) =>
        r.companyId === company.company_id
          ? { ...r, queued: false, startedAt: Date.now() }
          : r,
      ),
    );

    let completedViaEvent = false;

    const onRunComplete = () => {
      if (completedViaEvent) return;
      completedViaEvent = true;
      runningCountRef.current--;
      processQueueRef.current();
    };

    const controller = runAgentsSSE(
      company.company_id,
      (event) => {
        const { type, data } = event;

        if (
          type === "agent_connecting" ||
          type === "agent_browsing" ||
          type === "agent_streaming_url" ||
          type === "agent_status" ||
          type === "agent_complete" ||
          type === "agent_error"
        ) {
          const agentData = data as unknown as AgentState;
          setActiveRuns((prev) =>
            prev.map((r) => {
              if (r.companyId !== company.company_id) return r;
              const idx = r.agents.findIndex(
                (a) => a.agentId === agentData.agentId,
              );
              const agents =
                idx >= 0
                  ? r.agents.map((a) =>
                      a.agentId === agentData.agentId
                        ? { ...a, ...agentData }
                        : a,
                    )
                  : [...r.agents, agentData];
              return { ...r, agents };
            }),
          );
        } else if (type === "pipeline_complete") {
          abortControllersRef.current.delete(company.company_id);
          setActiveRuns((prev) =>
            prev.map((r) =>
              r.companyId === company.company_id
                ? { ...r, isComplete: true }
                : r,
            ),
          );
          onRunComplete();
        }
      },
      () => {
        abortControllersRef.current.delete(company.company_id);
        setActiveRuns((prev) =>
          prev.map((r) => {
            if (r.companyId !== company.company_id || r.isComplete) return r;
            const agents = r.agents.map((a) =>
              a.status !== "complete" && a.status !== "error"
                ? {
                    ...a,
                    status: "complete" as const,
                    findings: { signals: [] },
                    message: "0 results found",
                  }
                : a,
            );
            return { ...r, agents, isComplete: true };
          }),
        );
        onRunComplete();
      },
      (err) => {
        console.error("[RUNS] Agent run error:", err);
        abortControllersRef.current.delete(company.company_id);
        setActiveRuns((prev) =>
          prev.map((r) =>
            r.companyId === company.company_id
              ? { ...r, isComplete: true }
              : r,
          ),
        );
        onRunComplete();
      },
    );

    abortControllersRef.current.set(company.company_id, controller);
  }, []);

  const processQueue = useCallback(() => {
    while (
      runningCountRef.current < MAX_CONCURRENT_RUNS &&
      runQueueRef.current.length > 0
    ) {
      const next = runQueueRef.current.shift()!;
      executeRun(next.company);
    }
  }, [executeRun]);

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  const handleRunCompany = useCallback(
    (company: Company) => {
      if (
        activeRunsRef.current.some(
          (r) => r.companyId === company.company_id && !r.isComplete,
        )
      )
        return;
      if (
        runQueueRef.current.some(
          (q) => q.company.company_id === company.company_id,
        )
      )
        return;

      const willRunImmediately = runningCountRef.current < MAX_CONCURRENT_RUNS;
      const newRun: ActiveRun = {
        companyId: company.company_id,
        companyName: company.company_name,
        agents: [],
        isComplete: false,
        liveReport: null,
        startedAt: Date.now(),
        queued: !willRunImmediately,
      };

      setActiveRuns((prev) => [...prev, newRun]);

      if (willRunImmediately) {
        executeRun(company);
      } else {
        runQueueRef.current.push({ company });
      }
    },
    [executeRun],
  );

  const handleStopRun = useCallback(
    async (companyId: string) => {
      const controller = abortControllersRef.current.get(companyId);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(companyId);
      }

      const run = activeRunsRef.current.find((r) => r.companyId === companyId);
      const findings = (run?.agents ?? [])
        .filter((a) => a.status === "complete" && a.findings?.signals)
        .flatMap((a) => a.findings!.signals);

      setActiveRuns((prev) =>
        prev.map((r) =>
          r.companyId === companyId ? { ...r, isComplete: true } : r,
        ),
      );
      runningCountRef.current--;
      processQueue();

      try {
        const result = await stopRun(companyId, findings);
        setActiveRuns((prev) =>
          prev.map((r) =>
            r.companyId === companyId
              ? {
                  ...r,
                  liveReport: result.report_data,
                  emailSent: result.email_sent,
                }
              : r,
          ),
        );
      } catch (err) {
        console.error("[RUNS] Stop run failed:", err);
      }
    },
    [processQueue],
  );

  const handleDismissRun = useCallback((companyId: string) => {
    setActiveRuns((prev) => prev.filter((r) => r.companyId !== companyId));
  }, []);

  const handleRemoveQueued = useCallback((companyId: string) => {
    runQueueRef.current = runQueueRef.current.filter(
      (q) => q.company.company_id !== companyId,
    );
    setActiveRuns((prev) => prev.filter((r) => r.companyId !== companyId));
  }, []);

  return (
    <RunsContext.Provider
      value={{
        activeRuns,
        handleRunCompany,
        handleStopRun,
        handleDismissRun,
        handleRemoveQueued,
      }}
    >
      {children}
    </RunsContext.Provider>
  );
}

export function useRuns(): RunsContextType {
  const ctx = useContext(RunsContext);
  if (!ctx) throw new Error("useRuns must be used within RunsProvider");
  return ctx;
}
