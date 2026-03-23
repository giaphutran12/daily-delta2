import { useSimulatedProgress } from '../hooks/use-simulated-progress';
import { AgentState } from '../api/client';

const STATUS_LABELS: Record<string, string> = {
  connecting: 'Connecting',
  browsing: 'Browsing',
  analyzing: 'Analyzing',
  complete: 'Complete',
  error: 'Error',
};

const STATUS_COLORS: Record<string, string> = {
  connecting: 'text-black/40',
  browsing: 'text-[#1342FF]',
  analyzing: 'text-amber-600',
  complete: 'text-green-600',
  error: 'text-red-500',
};

const DOT_COLORS: Record<string, string> = {
  connecting: 'bg-black/30 animate-pulse',
  browsing: 'bg-[#1342FF] animate-pulse',
  analyzing: 'bg-amber-500 animate-pulse',
  complete: 'bg-green-500',
  error: 'bg-red-500',
};

interface AgentCardProps {
  agent: AgentState;
  startedAt: number;
}

export function AgentCard({ agent, startedAt }: AgentCardProps) {
  const statusColor = STATUS_COLORS[agent.status] || 'text-black/40';
  const statusLabel = STATUS_LABELS[agent.status] || agent.status;
  const dotColor = DOT_COLORS[agent.status] || 'bg-black/30';
  const isActive = agent.status === 'browsing' || agent.status === 'analyzing' || agent.status === 'connecting';
  const signalCount = agent.findings?.signals?.length ?? 0;
  const progress = useSimulatedProgress(agent.status, startedAt, agent.agentId);

  return (
    <div className="flex flex-col bg-white rounded-lg border border-black/8 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-black/6">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          <span className="text-[11px] font-medium text-black truncate">{agent.agentName}</span>
        </div>
        <span className={`text-[10px] font-medium uppercase tracking-wide shrink-0 ml-2 ${statusColor}`}
          style={{ fontFamily: "'Departure Mono', monospace" }}>
          {statusLabel}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full bg-black/5 overflow-hidden">
        <div
          className="h-full bg-[#1342FF] transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3">
        {/* Live streaming iframe */}
        {agent.streamingUrl && isActive && (
          <div className="flex flex-col gap-1">
            <div className="relative w-full overflow-hidden rounded-md border border-black/8 bg-black/5"
              style={{ aspectRatio: '16/9' }}>
              <iframe
                src={agent.streamingUrl}
                title={`Live: ${agent.agentName}`}
                sandbox="allow-scripts allow-same-origin"
                className="absolute inset-0 h-full w-full"
              />
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[9px] font-medium text-white" style={{ fontFamily: "'Departure Mono', monospace" }}>LIVE</span>
              </div>
            </div>
            <p className="text-[10px] text-black/40 truncate">{agent.streamingUrl}</p>
          </div>
        )}

        {/* Skeleton while connecting */}
        {agent.status === 'connecting' && !agent.streamingUrl && (
          <div className="flex flex-col gap-1.5">
            <div className="w-full rounded-md bg-black/5 animate-pulse" style={{ aspectRatio: '16/9' }} />
            <div className="h-2 w-3/4 rounded bg-black/5 animate-pulse" />
          </div>
        )}

        {/* Status message */}
        {agent.message && isActive && (
          <p className="text-[10px] text-black/45 line-clamp-2">{agent.message}</p>
        )}

        {/* Complete: signal count + preview */}
        {agent.status === 'complete' && (
          <div className="flex flex-col gap-1.5">
            <p className={`text-[11px] font-medium ${signalCount > 0 ? 'text-green-600' : 'text-black/35'}`}>
              {signalCount > 0 ? `${signalCount} signal${signalCount !== 1 ? 's' : ''} detected` : '0 results found'}
            </p>
            {agent.findings?.signals?.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded-md border border-black/6 bg-black/[0.02] px-2 py-1.5">
                <span className="shrink-0 rounded bg-[#1342FF]/10 px-1 py-0.5 text-[9px] font-medium text-[#1342FF]">
                  {s.signal_type.replace(/_/g, ' ')}
                </span>
                <span className="line-clamp-2 text-[10px] text-black/55">{s.title}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {agent.status === 'error' && agent.error && (
          <p className="text-[10px] text-red-500 line-clamp-3">{agent.error}</p>
        )}
      </div>
    </div>
  );
}
