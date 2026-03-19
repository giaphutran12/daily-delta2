/// <reference types="chrome"/>

const API_BASE = import.meta.env.VITE_API_BASE as string;
const STORAGE_KEY_RUNS = 'dd_active_runs';

// In-memory state — reset when SW is terminated/restarted
const runControllers = new Map<string, AbortController>();
const MAX_CONCURRENT_RUNS = 2;
let runningCount = 0;
const runQueue: Array<{ companyId: string; companyName: string; token: string; orgId: string | null }> = [];

// ── Lifecycle ────────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setOptions({ enabled: true });

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Daily Delta] Extension installed');
});

// ── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.type === 'GET_PAGE_INFO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      sendResponse(tab
        ? { url: tab.url || '', title: tab.title || '', domain: tab.url ? new URL(tab.url).hostname.replace(/^www\./, '') : '' }
        : { url: '', title: '', domain: '' });
    });
    return true;
  }

  if (message.type === 'GET_ACTIVE_RUNS') {
    chrome.storage.local.get(STORAGE_KEY_RUNS, (r) => {
      sendResponse({ runs: r[STORAGE_KEY_RUNS] ?? {} });
    });
    return true;
  }

  if (message.type === 'START_RUN') {
    handleStartRun(
      message.companyId as string,
      message.companyName as string,
      message.authToken as string,
      message.orgId as string | null,
    ).catch((e) => console.error('[Daily Delta] handleStartRun error:', e));
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'STOP_RUN') {
    handleStopRun(message.companyId as string)
      .catch((e) => console.error('[Daily Delta] handleStopRun error:', e));
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'REMOVE_QUEUED') {
    handleRemoveQueued(message.companyId as string)
      .catch((e) => console.error('[Daily Delta] handleRemoveQueued error:', e));
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'CLEAR_RUN') {
    const ctrl = runControllers.get(message.companyId as string);
    if (ctrl) { ctrl.abort(); runControllers.delete(message.companyId as string); }
    chrome.storage.local.get(STORAGE_KEY_RUNS, (r) => {
      const runs: Record<string, unknown> = r[STORAGE_KEY_RUNS] ?? {};
      delete runs[message.companyId as string];
      chrome.storage.local.set({ [STORAGE_KEY_RUNS]: runs });
    });
    sendResponse({ ok: true });
    return false;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcast(msg: Record<string, unknown>) {
  chrome.runtime.sendMessage(msg).catch(() => { /* panel not open — that's fine */ });
}

async function readStorage<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (r) => resolve((r[key] as T) ?? null));
  });
}

async function getRuns(): Promise<Record<string, unknown>> {
  return (await readStorage<Record<string, unknown>>(STORAGE_KEY_RUNS)) ?? {};
}

async function patchRun(companyId: string, patch: Record<string, unknown>) {
  const runs = await getRuns();
  runs[companyId] = { ...(runs[companyId] as Record<string, unknown> ?? {}), ...patch };
  await new Promise<void>((resolve) =>
    chrome.storage.local.set({ [STORAGE_KEY_RUNS]: runs }, resolve)
  );
  return runs[companyId] as Record<string, unknown>;
}

// ── Queue management ──────────────────────────────────────────────────────────

function processQueue() {
  while (runningCount < MAX_CONCURRENT_RUNS && runQueue.length > 0) {
    const next = runQueue.shift()!;
    executeRun(next.companyId, next.token, next.orgId);
  }
}

// ── Run management ───────────────────────────────────────────────────────────

async function handleStartRun(companyId: string, companyName: string, token: string, orgId: string | null) {
  if (!token) {
    console.warn('[Daily Delta] No auth token — cannot start run');
    return;
  }

  // Guard: already active (not complete) — ignore
  const existing = await getRuns();
  const existingRun = existing[companyId] as Record<string, unknown> | undefined;
  if (existingRun && !existingRun.isComplete) return;

  // Cancel any stale controller
  runControllers.get(companyId)?.abort();
  runControllers.delete(companyId);

  const willRunImmediately = runningCount < MAX_CONCURRENT_RUNS;

  const initialRun: Record<string, unknown> = {
    companyId,
    companyName,
    agents: [],
    isComplete: false,
    liveReport: null,
    emailSent: false,
    startedAt: Date.now(),
    queued: !willRunImmediately,
    authToken: token,
    orgId,
  };

  const runs = await getRuns();
  runs[companyId] = initialRun;
  await new Promise<void>((r) => chrome.storage.local.set({ [STORAGE_KEY_RUNS]: runs }, r));
  broadcast({ type: 'RUN_STARTED', run: initialRun });

  if (willRunImmediately) {
    executeRun(companyId, token, orgId);
  } else {
    runQueue.push({ companyId, companyName, token, orgId });
  }
}

function executeRun(companyId: string, token: string, orgId: string | null) {
  runningCount++;
  doExecuteRun(companyId, token, orgId).catch((e) =>
    console.error('[Daily Delta] executeRun error:', e)
  );
}

async function doExecuteRun(companyId: string, token: string, orgId: string | null) {
  // Mark as active (not queued)
  const startedRun = await patchRun(companyId, { queued: false, startedAt: Date.now() });
  broadcast({ type: 'RUN_UPDATE', run: startedRun });

  const controller = new AbortController();
  runControllers.set(companyId, controller);

  let completed = false;
  const onComplete = () => {
    if (completed) return;
    completed = true;
    runningCount = Math.max(0, runningCount - 1);
    runControllers.delete(companyId);
    processQueue();
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (orgId) headers['X-Organization-Id'] = orgId;

  try {
    const res = await fetch(`${API_BASE}/run-agents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ company_id: companyId }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const run = await patchRun(companyId, { isComplete: true, error: (err as { error?: string }).error ?? 'Failed' });
      broadcast({ type: 'RUN_UPDATE', run });
      onComplete();
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          await processEvent(companyId, JSON.parse(line.slice(6)) as Record<string, unknown>, onComplete);
        } catch { /* malformed — skip */ }
      }
    }

  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('[Daily Delta] Run stream error:', err);
    }
  } finally {
    onComplete();
    const run = await patchRun(companyId, { isComplete: true });
    broadcast({ type: 'RUN_UPDATE', run });
  }
}

async function handleStopRun(companyId: string) {
  const ctrl = runControllers.get(companyId);
  if (ctrl) { ctrl.abort(); runControllers.delete(companyId); }

  runningCount = Math.max(0, runningCount - 1);
  processQueue();

  // Read token + findings from storage
  const runs = await getRuns();
  const run = runs[companyId] as Record<string, unknown> | undefined;
  const token = run?.authToken as string | undefined;
  const orgId = run?.orgId as string | null | undefined;
  const agents = (run?.agents as Array<Record<string, unknown>>) ?? [];

  const findings = agents
    .filter((a) => a.status === 'complete' && a.findings)
    .flatMap((a) => {
      const f = a.findings as { signals?: Array<Record<string, unknown>> };
      return f?.signals ?? [];
    });

  const updatedRun = await patchRun(companyId, { isComplete: true });
  broadcast({ type: 'RUN_UPDATE', run: updatedRun });

  if (!token) return;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (orgId) headers['X-Organization-Id'] = orgId;

    const res = await fetch(`${API_BASE}/stop-run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ company_id: companyId, findings }),
    });

    if (res.ok) {
      const result = await res.json() as { report_data?: unknown; email_sent?: boolean };
      const finalRun = await patchRun(companyId, {
        liveReport: result.report_data ?? null,
        emailSent: result.email_sent ?? false,
      });
      broadcast({ type: 'RUN_UPDATE', run: finalRun });
    }
  } catch (err) {
    console.error('[Daily Delta] stop-run API error:', err);
  }
}

async function handleRemoveQueued(companyId: string) {
  // Remove from in-memory queue
  const idx = runQueue.findIndex((q) => q.companyId === companyId);
  if (idx >= 0) runQueue.splice(idx, 1);

  // Remove from storage
  const runs = await getRuns();
  delete runs[companyId];
  await new Promise<void>((r) => chrome.storage.local.set({ [STORAGE_KEY_RUNS]: runs }, r));

  broadcast({ type: 'RUN_REMOVED', companyId });
}

// All event types the server sends for agent progress
const AGENT_EVENT_TYPES = new Set([
  'agent_connecting',
  'agent_browsing',
  'agent_streaming_url',
  'agent_status',
  'agent_complete',
  'agent_error',
]);

async function processEvent(companyId: string, evt: Record<string, unknown>, onComplete: () => void) {
  const type = evt.type as string | undefined;
  if (!type) return;

  if (type === 'queued') {
    const run = await patchRun(companyId, { queued: true });
    broadcast({ type: 'RUN_UPDATE', run });
    return;
  }

  if (type === 'dequeued' || type === 'pipeline_started') {
    const run = await patchRun(companyId, { queued: false });
    broadcast({ type: 'RUN_UPDATE', run });
    return;
  }

  if (type === 'pipeline_complete') {
    const run = await patchRun(companyId, { isComplete: true, queued: false });
    broadcast({ type: 'RUN_UPDATE', run });
    onComplete();
    return;
  }

  if (type === 'report_generated' || type === 'live_report') {
    const run = await patchRun(companyId, { liveReport: evt.data ?? null });
    broadcast({ type: 'RUN_UPDATE', run });
    return;
  }

  if (AGENT_EVENT_TYPES.has(type)) {
    const agentData = evt.data as Record<string, unknown> | undefined;
    if (!agentData) return;
    const agentId = agentData.agentId as string | undefined;
    if (!agentId) return;

    const currentRuns = await getRuns();
    const run = currentRuns[companyId] as Record<string, unknown> | undefined;
    if (!run) return;

    const agents = (run.agents as Array<Record<string, unknown>>) ?? [];
    const idx = agents.findIndex((a) => a.agentId === agentId);

    if (idx >= 0) {
      agents[idx] = { ...agents[idx], ...agentData };
    } else {
      agents.push({ ...agentData });
    }

    const updatedRun = await patchRun(companyId, { agents: [...agents] });
    broadcast({ type: 'RUN_UPDATE', run: updatedRun });
  }
}
