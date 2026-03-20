import { useState, useEffect } from 'react';
import { ActiveRun } from '../api/client';
import { AgentCard } from '../components/AgentCard';
import { useAggregateSimulatedProgress } from '../hooks/use-simulated-progress';

interface ActiveRunsTabProps {
  activeRuns: Record<string, ActiveRun>;
  setActiveRuns: React.Dispatch<React.SetStateAction<Record<string, ActiveRun>>>;
}

export function ActiveRunsTab({ activeRuns, setActiveRuns }: ActiveRunsTabProps) {
  const runs = Object.values(activeRuns).sort((a, b) => a.startedAt - b.startedAt);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-select first run, prefer a running one
  useEffect(() => {
    if (runs.length === 0) { setSelectedId(null); return; }
    if (selectedId && activeRuns[selectedId]) return;
    const running = runs.find((r) => !r.isComplete);
    setSelectedId((running ?? runs[0]).companyId);
  }, [runs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = (companyId: string) => {
    chrome.runtime.sendMessage({ type: 'CLEAR_RUN', companyId });
    setActiveRuns((prev) => {
      const next = { ...prev };
      delete next[companyId];
      return next;
    });
    if (selectedId === companyId) {
      const remaining = runs.filter((r) => r.companyId !== companyId);
      setSelectedId(remaining[0]?.companyId ?? null);
    }
  };

  const handleStop = (companyId: string) => {
    chrome.runtime.sendMessage({ type: 'STOP_RUN', companyId });
  };

  const handleRemoveQueued = (companyId: string) => {
    chrome.runtime.sendMessage({ type: 'REMOVE_QUEUED', companyId });
    // State removed via RUN_REMOVED broadcast from background
    if (selectedId === companyId) {
      const remaining = runs.filter((r) => r.companyId !== companyId);
      setSelectedId(remaining[0]?.companyId ?? null);
    }
  };

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-2">
        <p className="text-[13px] text-black/40">No active runs</p>
        <p className="text-[11px] text-black/25">Start a run from the Companies tab.</p>
      </div>
    );
  }

  const selected = selectedId ? activeRuns[selectedId] : runs[0];

  const totalAgents = selected?.agents.length ?? 0;
  const runStartedAt = selected?.startedAt ?? Date.now();
  const agentsForProgress = selected?.agents.map((a) => ({
    agentId: a.agentId,
    status: a.status,
  })) ?? [];
  const progressPct = useAggregateSimulatedProgress(agentsForProgress, runStartedAt);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Horizontal company tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto bg-white border-b border-black/8 px-3 py-2 shrink-0"
        style={{ scrollbarWidth: 'none' }}>
        {runs.map((run) => {
          const isActive = (selectedId ?? runs[0]?.companyId) === run.companyId;
          const done = run.agents.filter((a) => a.status === 'complete').length;
          const total = run.agents.length;
          return (
            <button
              key={run.companyId}
              onClick={() => setSelectedId(run.companyId)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-[#1342FF] text-white'
                  : 'bg-black/5 text-black/55 hover:bg-black/8 hover:text-black/70'
              }`}
            >
              {!run.isComplete && !run.queued && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 animate-pulse ${isActive ? 'bg-white' : 'bg-[#1342FF]'}`} />
              )}
              <span>{run.companyName}</span>
              {run.queued && (
                <span className={`text-[9px] font-normal px-1.5 py-0.5 rounded border ${
                  isActive ? 'border-white/30 text-white/70' : 'border-black/15 text-black/40'
                }`} style={{ fontFamily: "'Departure Mono', monospace" }}>
                  Queued
                </span>
              )}
              {!run.queued && total > 0 && !run.isComplete && (
                <span className={`text-[10px] ${isActive ? 'text-white/70' : 'text-black/35'}`}>
                  {done}/{total}
                </span>
              )}
              {run.isComplete && (
                <span className={`text-[10px] ${isActive ? 'text-white/75' : 'text-green-600'}`}>✓</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected run details */}
      {selected && (
        <div className="flex-1 overflow-y-auto">
          {/* Run header */}
          <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-black/8 sticky top-0 z-10">
            <div>
              <div className="text-[13px] font-semibold text-black">{selected.companyName}</div>
              <div className="text-[10px] mt-0.5" style={{ fontFamily: "'Departure Mono', monospace" }}>
                {selected.queued ? (
                  <span className="text-amber-500">Queued — waiting for a slot</span>
                ) : selected.isComplete ? (
                  <span className="text-green-600">✓ Run complete</span>
                ) : (
                  <span className="text-[#1342FF]">
                    {selected.agents.filter((a) => a.status !== 'complete' && a.status !== 'error').length} agent{selected.agents.filter((a) => a.status !== 'complete' && a.status !== 'error').length !== 1 ? 's' : ''} running
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected.queued && (
                <button
                  onClick={() => handleRemoveQueued(selected.companyId)}
                  className="flex items-center gap-1 text-[10px] text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded cursor-pointer transition-colors"
                  style={{ fontFamily: "'Departure Mono', monospace" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                  Remove
                </button>
              )}
              {!selected.isComplete && !selected.queued && (
                <button
                  onClick={() => handleStop(selected.companyId)}
                  className="flex items-center gap-1 text-[10px] text-white bg-red-500 hover:bg-red-600 px-2.5 py-1 rounded cursor-pointer transition-colors"
                  style={{ fontFamily: "'Departure Mono', monospace" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                  Stop
                </button>
              )}
              {selected.isComplete && (
                <button
                  onClick={() => handleDismiss(selected.companyId)}
                  className="text-[10px] text-black/40 hover:text-black/70 border border-black/15 hover:border-black/30 px-2.5 py-1 rounded cursor-pointer transition-colors"
                  style={{ fontFamily: "'Departure Mono', monospace" }}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          <div className="p-4 flex flex-col gap-3">
            {/* Email sent notice */}
            {selected.emailSent && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[11px] text-green-700">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Report email sent (check spam and updates folders)
              </div>
            )}

            {/* Progress bar */}
            {!selected.isComplete && totalAgents > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] text-black/35">
                  <span>{totalAgents} agent{totalAgents !== 1 ? 's' : ''} running</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-black/8 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#1342FF] transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Agent cards */}
            {selected.agents.length > 0 ? (
              <div className="flex flex-col gap-2">
                {selected.agents.map((agent) => (
                  <AgentCard key={agent.agentId} agent={agent} startedAt={runStartedAt} />
                ))}
              </div>
            ) : selected.queued ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <div className="w-8 h-8 border-2 border-black/10 border-t-amber-400 rounded-full animate-spin" />
                <p className="text-[11px] text-black/35">Queued — waiting for a slot…</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <div className="w-6 h-6 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
                  <p className="text-[11px] text-black/35">Launching agents…</p>
                </div>
                {/* Skeleton cards while agents load */}
                {[1, 2, 3].map((k) => (
                  <div key={k} className="flex flex-col gap-2.5 bg-white rounded-lg border border-black/8 p-3">
                    <div className="h-3 w-2/3 rounded bg-black/5 animate-pulse" />
                    <div className="w-full rounded-md bg-black/5 animate-pulse" style={{ aspectRatio: '16/9' }} />
                    <div className="h-2.5 w-full rounded bg-black/5 animate-pulse" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
