import { useState, useEffect, useRef } from 'react';
import {
  Company,
  SignalDefinition,
  AgentState,
  ActiveRun,
  getCompanies,
  deleteCompany,
  getSignalDefinitions,
  createSignalDefinition,
  deleteSignalDefinition,
  storeCompanySSE,
} from '../api/client';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { AgentCard } from '../components/AgentCard';

type StorePhase = 'idle' | 'storing' | 'done' | 'error';

interface PendingSignal {
  name: string;
  target_url: string;
  search_instructions: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function CompaniesTab({ activeRuns }: {
  activeRuns: Record<string, ActiveRun>;
}) {
  const { currentOrg, session } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyLimit, setCompanyLimit] = useState(5);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Store company
  const [storeUrl, setStoreUrl] = useState('');
  const [storePhase, setStorePhase] = useState<StorePhase>('idle');
  const [storeMessage, setStoreMessage] = useState('');
  const [storeAgents, setStoreAgents] = useState<AgentState[]>([]);
  const [storeStartedAt, setStoreStartedAt] = useState(Date.now());
  const [storedCompanyId, setStoredCompanyId] = useState<string | null>(null);
  const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
  const [pendingFormOpen, setPendingFormOpen] = useState(false);
  const [pendingForm, setPendingForm] = useState({ name: '', target_url: '', search_instructions: '' });
  const abortRef = useRef<AbortController | null>(null);

  // Edit signals modal
  const [editCompany, setEditCompany] = useState<Company | null>(null);
  const [companySignals, setCompanySignals] = useState<SignalDefinition[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', target_url: '', search_instructions: '' });
  const [editFormOpen, setEditFormOpen] = useState(false);
  const [editError, setEditError] = useState('');

  // Current page URL
  const [pageUrl, setPageUrl] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_PAGE_INFO' }, (info) => {
      if (chrome.runtime.lastError) return;
      if (info?.url) setPageUrl(info.url);
    });
  }, []);

  const loadCompanies = async () => {
    setLoading(true);
    setError('');
    try {
      const { companies: c, company_limit } = await getCompanies();
      setCompanies(c);
      setCompanyLimit(company_limit);
    } catch {
      setError('Failed to load companies');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentOrg) loadCompanies();
  }, [currentOrg]);

  // ── Store company ──────────────────────────────────────────────────────────

  const handleStore = () => {
    const url = storeUrl.trim() || pageUrl;
    if (!url) return;
    setStorePhase('storing');
    setStoreMessage('Connecting…');
    setStoreAgents([]);
    setStoreStartedAt(Date.now());
    setStoredCompanyId(null);
    setPendingSignals([]);

    abortRef.current = storeCompanySSE(
      url,
      (event) => {
        const d = event.data as Record<string, unknown>;
        if (event.type === 'company_stored') {
          const cid = (d.company_id ?? (d.company as Record<string, unknown>)?.company_id) as string | undefined;
          if (cid) setStoredCompanyId(cid);
          setStoreMessage('Company stored. Discovering…');
        } else if (event.type === 'agent_update') {
          const agentData = (d ?? event) as unknown as AgentState;
          setStoreAgents((prev) => {
            const idx = prev.findIndex((a) => a.agentId === agentData.agentId);
            if (idx >= 0) { const next = [...prev]; next[idx] = agentData; return next; }
            return [...prev, agentData];
          });
        } else if (event.type === 'status') {
          setStoreMessage((d.message as string) || '');
        }
      },
      async () => {
        setStorePhase('done');
        setStoreMessage('');
        await loadCompanies();
      },
      (err) => {
        setStorePhase('error');
        setStoreMessage(err);
      },
    );
  };

  const handleFinishStore = async () => {
    if (storedCompanyId && pendingSignals.length > 0) {
      for (const s of pendingSignals) {
        try {
          await createSignalDefinition({
            name: s.name,
            signal_type: slugify(s.name),
            display_name: s.name,
            target_url: s.target_url,
            search_instructions: s.search_instructions,
            scope: 'company',
            company_id: storedCompanyId,
          });
        } catch { /* ignore individual */ }
      }
    }
    setStorePhase('idle');
    setStoreUrl('');
    setStoredCompanyId(null);
    setPendingSignals([]);
    setPendingFormOpen(false);
  };

  // ── Run agents — delegated to background service worker ───────────────────

  const handleRunAgents = async (company: Company) => {
    // Get a fresh token directly from Supabase — don't rely on storage sync
    let token = session?.access_token ?? null;
    if (!token) {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
    }
    if (!token) return;

    chrome.runtime.sendMessage({
      type: 'START_RUN',
      companyId: company.company_id,
      companyName: company.company_name,
      authToken: token,
      orgId: currentOrg?.organization_id ?? null,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this company?')) return;
    await deleteCompany(id);
    setCompanies((prev) => prev.filter((c) => c.company_id !== id));
  };

  // ── Edit signals modal ─────────────────────────────────────────────────────

  const openEditSignals = async (company: Company) => {
    setEditCompany(company);
    setSignalsLoading(true);
    setEditError('');
    setEditFormOpen(false);
    try {
      const sigs = await getSignalDefinitions(company.company_id);
      setCompanySignals(sigs.filter((s) => s.scope === 'company'));
    } catch {
      setEditError('Failed to load signals');
    } finally {
      setSignalsLoading(false);
    }
  };

  const handleCreateSignal = async () => {
    if (!editCompany || !editForm.name.trim()) return;
    setEditError('');
    try {
      const created = await createSignalDefinition({
        name: editForm.name,
        signal_type: slugify(editForm.name),
        display_name: editForm.name,
        target_url: editForm.target_url,
        search_instructions: editForm.search_instructions,
        scope: 'company',
        company_id: editCompany.company_id,
      });
      setCompanySignals((prev) => [...prev, created]);
      setEditForm({ name: '', target_url: '', search_instructions: '' });
      setEditFormOpen(false);
    } catch {
      setEditError('Failed to create signal');
    }
  };

  const handleDeleteSignal = async (id: string) => {
    await deleteSignalDefinition(id);
    setCompanySignals((prev) => prev.filter((s) => s.id !== id));
  };

  if (!currentOrg) {
    return (
      <div className="flex items-center justify-center h-32">
        <p className="text-[12px] text-black/40">No organization selected</p>
      </div>
    );
  }

  // ── Edit signals view ──────────────────────────────────────────────────────

  if (editCompany) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-black/8 bg-white">
          <button
            onClick={() => setEditCompany(null)}
            className="text-[#1342FF] text-[11px] hover:text-[#0F35D9] cursor-pointer"
            style={{ fontFamily: "'Departure Mono', monospace" }}
          >
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-black truncate">{editCompany.company_name}</div>
            <div className="text-[10px] text-black/40 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>Custom Signals</div>
          </div>
          <button
            onClick={() => setEditFormOpen(true)}
            className="px-2.5 py-1 bg-[#1342FF] text-white text-[10px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-[#0F35D9]"
            style={{ fontFamily: "'Departure Mono', monospace" }}
          >
            + Add
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {editError && <p className="text-red-600 text-[11px]">{editError}</p>}
          {editFormOpen && (
            <div className="bg-white border border-[#1342FF]/30 rounded p-3 flex flex-col gap-2">
              <input className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none" placeholder="Signal name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
              <input className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none" placeholder="Target URL" value={editForm.target_url} onChange={(e) => setEditForm((f) => ({ ...f, target_url: e.target.value }))} />
              <textarea className="w-full px-2.5 py-2 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none resize-none" placeholder="Search instructions" rows={2} value={editForm.search_instructions} onChange={(e) => setEditForm((f) => ({ ...f, search_instructions: e.target.value }))} />
              <div className="flex gap-2">
                <button onClick={handleCreateSignal} className="flex-1 h-7 bg-[#1342FF] text-white text-[10px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-[#0F35D9]" style={{ fontFamily: "'Departure Mono', monospace" }}>Save</button>
                <button onClick={() => setEditFormOpen(false)} className="flex-1 h-7 bg-black/5 text-black/50 text-[10px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-black/10" style={{ fontFamily: "'Departure Mono', monospace" }}>Cancel</button>
              </div>
            </div>
          )}
          {signalsLoading ? (
            <div className="flex justify-center py-8"><span className="w-5 h-5 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" /></div>
          ) : companySignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2">
              <p className="text-[12px] text-black/40 text-center">No custom signals yet.</p>
              <p className="text-[11px] text-black/30 text-center">Add signals to track specific topics.</p>
            </div>
          ) : (
            companySignals.map((sig) => (
              <div key={sig.id} className="flex items-start justify-between gap-2 bg-white border border-black/8 rounded px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-black">{sig.display_name}</div>
                  {sig.target_url && <div className="text-[10px] text-black/40 truncate mt-0.5">{sig.target_url}</div>}
                  {sig.search_instructions && <div className="text-[10px] text-black/35 mt-0.5 line-clamp-2">{sig.search_instructions}</div>}
                </div>
                <button onClick={() => handleDeleteSignal(sig.id)} className="text-black/25 hover:text-red-500 transition-colors cursor-pointer shrink-0 mt-0.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── Store phase view ───────────────────────────────────────────────────────

  if (storePhase === 'storing' || storePhase === 'done') {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-black/8 bg-white">
          <div className="text-[12px] font-semibold text-black">{storePhase === 'done' ? 'Company Stored' : 'Storing Company…'}</div>
          {storeMessage && <div className="text-[10px] text-black/40 mt-0.5">{storeMessage}</div>}
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {storeAgents.map((agent) => <AgentCard key={agent.agentId} agent={agent} startedAt={storeStartedAt} />)}
          {storePhase === 'done' && (
            <div className="mt-4 flex flex-col gap-3">
              <div className="bg-green-50 border border-green-200 rounded px-3 py-2.5">
                <p className="text-green-700 text-[12px] text-center">Company successfully stored!</p>
              </div>
              <div className="bg-white border border-black/8 rounded p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-black/50 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>Custom Signals</span>
                  {!pendingFormOpen && (
                    <button onClick={() => setPendingFormOpen(true)} className="text-[10px] text-[#1342FF] hover:text-[#0F35D9] font-semibold cursor-pointer" style={{ fontFamily: "'Departure Mono', monospace" }}>+ Add</button>
                  )}
                </div>
                {pendingSignals.length === 0 && !pendingFormOpen && (
                  <p className="text-[11px] text-black/30">Optionally add signals to track specific topics.</p>
                )}
                {pendingSignals.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-[#F5F5F5] rounded px-2.5 py-1.5">
                    <span className="text-[11px] text-black/70">{s.name}</span>
                    <button onClick={() => setPendingSignals((prev) => prev.filter((_, j) => j !== i))} className="text-black/25 hover:text-red-500 cursor-pointer">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ))}
                {pendingFormOpen && (
                  <div className="flex flex-col gap-1.5">
                    <input className="w-full h-7 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[11px] focus:border-[#1342FF] focus:outline-none" placeholder="Signal name" value={pendingForm.name} onChange={(e) => setPendingForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
                    <input className="w-full h-7 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[11px] focus:border-[#1342FF] focus:outline-none" placeholder="Target URL" value={pendingForm.target_url} onChange={(e) => setPendingForm((f) => ({ ...f, target_url: e.target.value }))} />
                    <textarea className="w-full px-2.5 py-1.5 bg-[#F5F5F5] border border-black/10 rounded text-[11px] focus:border-[#1342FF] focus:outline-none resize-none" placeholder="Instructions" rows={2} value={pendingForm.search_instructions} onChange={(e) => setPendingForm((f) => ({ ...f, search_instructions: e.target.value }))} />
                    <div className="flex gap-1.5">
                      <button onClick={() => { if (!pendingForm.name.trim()) return; setPendingSignals((p) => [...p, { ...pendingForm }]); setPendingForm({ name: '', target_url: '', search_instructions: '' }); setPendingFormOpen(false); }} className="flex-1 h-6 bg-[#1342FF] text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-[#0F35D9]" style={{ fontFamily: "'Departure Mono', monospace" }}>Add</button>
                      <button onClick={() => setPendingFormOpen(false)} className="flex-1 h-6 bg-black/5 text-black/50 text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer" style={{ fontFamily: "'Departure Mono', monospace" }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={handleFinishStore} className="w-full h-9 bg-[#1342FF] hover:bg-[#0F35D9] text-white text-[10px] font-semibold rounded uppercase tracking-wider cursor-pointer transition-colors" style={{ fontFamily: "'Departure Mono', monospace" }}>Done</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (storePhase === 'error') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3">
          <div className="bg-red-50 border border-red-200 rounded px-4 py-3 w-full">
            <p className="text-red-600 text-[12px] text-center">{storeMessage}</p>
          </div>
          <button onClick={() => setStorePhase('idle')} className="text-[11px] text-[#1342FF] hover:text-[#0F35D9] cursor-pointer">Try again</button>
        </div>
      </div>
    );
  }

  // ── Main companies list ────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 bg-white border-b border-black/8">
        <div className="flex gap-2">
          <input
            className="flex-1 h-8 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[12px] text-black placeholder-black/30 focus:border-[#1342FF] focus:outline-none transition-all"
            style={{ fontFamily: "'PT Serif', Georgia, serif" }}
            placeholder={pageUrl || 'Company website URL'}
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStore()}
          />
          <button
            onClick={handleStore}
            disabled={!storeUrl.trim() && !pageUrl}
            className="px-3 h-8 bg-[#1342FF] hover:bg-[#0F35D9] disabled:opacity-40 text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer transition-colors whitespace-nowrap"
            style={{ fontFamily: "'Departure Mono', monospace" }}
          >
            Store
          </button>
        </div>
        {pageUrl && !storeUrl && (
          <p className="text-[10px] text-black/35 mt-1">
            Current page: <span className="text-black/50">{pageUrl.slice(0, 45)}{pageUrl.length > 45 ? '…' : ''}</span>
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="text-red-600 text-[11px] mb-3">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-10">
            <span className="w-5 h-5 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-[13px] text-black/40 text-center">No companies tracked yet.</p>
            <p className="text-[11px] text-black/25 text-center">Enter a URL above to get started.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-black/35 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
                {companies.length} / {companyLimit} companies
              </span>
            </div>
            {companies.map((company) => {
              const run = activeRuns[company.company_id];
              const isRunning = run && !run.isComplete;
              const isQueued = run?.queued;
              return (
                <div key={company.company_id} className="bg-white border border-black/8 rounded px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-black truncate">{company.company_name}</div>
                      <div className="text-[10px] text-black/40 truncate mt-0.5">{company.domain}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => openEditSignals(company)}
                        className="w-6 h-6 flex items-center justify-center text-black/30 border border-black/10 rounded hover:border-[#1342FF] hover:text-[#1342FF] transition-colors cursor-pointer"
                        title="Edit custom signals"
                      >
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                          <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => !isRunning && handleRunAgents(company)}
                        disabled={!!isRunning}
                        className="h-6 px-2 text-[9px] font-medium text-white bg-[#1342FF] rounded hover:bg-[#0F35D9] disabled:opacity-40 transition-colors cursor-pointer uppercase tracking-wider"
                        style={{ fontFamily: "'Departure Mono', monospace" }}
                      >
                        {isQueued ? 'Queued' : isRunning ? 'Running…' : 'Run'}
                      </button>
                      <button
                        onClick={() => handleDelete(company.company_id)}
                        className="text-black/20 hover:text-red-500 transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  {run?.isComplete && (
                    <div className="mt-1.5 text-[10px] text-green-600 font-medium" style={{ fontFamily: "'Departure Mono', monospace" }}>
                      ✓ Run complete
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
