import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  getUserSettings,
  setEmailFrequency,
  EmailFrequency,
  createOrganization,
  getOrgMembers,
  inviteMember,
  removeMember,
  cancelInvitation,
  OrganizationMember,
  getSignalDefinitions,
  createSignalDefinition,
  updateSignalDefinition,
  deleteSignalDefinition,
  SignalDefinition,
} from '../api/client';

const FREQUENCY_OPTIONS: { value: EmailFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'every_3_days', label: 'Every 3 days' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'only_on_run', label: 'Only on run' },
];

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

type Section = 'general' | 'signals' | 'workspace';

export function SettingsTab() {
  const { user, organizations, currentOrg, setCurrentOrg, refreshOrgs, signOut } = useAuth();

  const [activeSection, setActiveSection] = useState<Section>('general');

  // General
  const [emailFreq, setEmailFreqState] = useState<EmailFrequency>('daily');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [freqSaving, setFreqSaving] = useState(false);

  // Signals
  const [signals, setSignals] = useState<SignalDefinition[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalFormOpen, setSignalFormOpen] = useState(false);
  const [signalForm, setSignalForm] = useState({ name: '', target_url: '', search_instructions: '' });
  const [signalError, setSignalError] = useState('');
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null);
  const [editingSignalForm, setEditingSignalForm] = useState({ name: '', target_url: '', search_instructions: '' });

  // Workspace (members + org)
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [newOrgName, setNewOrgName] = useState('');
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState('');

  useEffect(() => {
    getUserSettings()
      .then((s) => { if (s.email_frequency) setEmailFreqState(s.email_frequency); })
      .catch(() => {})
      .finally(() => setSettingsLoading(false));
  }, []);

  useEffect(() => {
    if (activeSection !== 'signals') return;
    setSignalsLoading(true);
    getSignalDefinitions()
      .then((defs) => setSignals(defs.filter((d) => d.scope === 'global')))
      .catch(() => {})
      .finally(() => setSignalsLoading(false));
  }, [activeSection]);

  useEffect(() => {
    if (!currentOrg || activeSection !== 'workspace') return;
    setMembersLoading(true);
    getOrgMembers(currentOrg.organization_id)
      .then(setMembers)
      .catch(() => {})
      .finally(() => setMembersLoading(false));
  }, [currentOrg, activeSection]);

  const handleFreqChange = async (freq: EmailFrequency) => {
    setEmailFreqState(freq);
    setFreqSaving(true);
    try { await setEmailFrequency(freq); } finally { setFreqSaving(false); }
  };

  const handleCreateSignal = async () => {
    if (!signalForm.name.trim()) return;
    setSignalError('');
    try {
      const created = await createSignalDefinition({
        name: signalForm.name,
        signal_type: slugify(signalForm.name),
        display_name: signalForm.name,
        target_url: signalForm.target_url,
        search_instructions: signalForm.search_instructions,
        scope: 'global',
      });
      setSignals((prev) => [...prev, created]);
      setSignalForm({ name: '', target_url: '', search_instructions: '' });
      setSignalFormOpen(false);
    } catch {
      setSignalError('Failed to create signal');
    }
  };

  const startEditSignal = (sig: SignalDefinition) => {
    setEditingSignalId(sig.id);
    setEditingSignalForm({ name: sig.display_name, target_url: sig.target_url, search_instructions: sig.search_instructions });
  };

  const handleSaveEditSignal = async (id: string) => {
    if (!editingSignalForm.name.trim()) return;
    setSignalError('');
    try {
      const updated = await updateSignalDefinition(id, {
        name: editingSignalForm.name,
        signal_type: slugify(editingSignalForm.name),
        display_name: editingSignalForm.name,
        target_url: editingSignalForm.target_url,
        search_instructions: editingSignalForm.search_instructions,
      });
      setSignals((prev) => prev.map((s) => s.id === id ? updated : s));
      setEditingSignalId(null);
    } catch {
      setSignalError('Failed to update signal');
    }
  };

  const handleDeleteSignal = async (id: string) => {
    await deleteSignalDefinition(id);
    setSignals((prev) => prev.filter((s) => s.id !== id));
  };

  const handleInvite = async () => {
    if (!currentOrg || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setInviteError('');
    setInviteSuccess('');
    const result = await inviteMember(currentOrg.organization_id, inviteEmail.trim());
    if (result.success) {
      setInviteSuccess('Invitation sent!');
      setInviteEmail('');
      const updated = await getOrgMembers(currentOrg.organization_id);
      setMembers(updated);
    } else {
      setInviteError(result.error || 'Failed to invite');
    }
    setInviteLoading(false);
  };

  const handleRemove = async (userId: string) => {
    if (!currentOrg || !confirm('Remove this member?')) return;
    await removeMember(currentOrg.organization_id, userId);
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  };

  const handleCancelInvite = async (invitationId: string) => {
    if (!currentOrg) return;
    await cancelInvitation(currentOrg.organization_id, invitationId);
    setMembers((prev) => prev.filter((m) => m.id !== invitationId));
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return;
    setOrgLoading(true);
    setOrgError('');
    try {
      const org = await createOrganization(newOrgName.trim());
      await refreshOrgs();
      setCurrentOrg(org);
      setNewOrgName('');
    } catch {
      setOrgError('Failed to create organization');
    } finally {
      setOrgLoading(false);
    }
  };

  const canManage = currentOrg
    ? organizations.find((o) => o.organization_id === currentOrg.organization_id)?.role !== 'member'
    : false;

  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'signals', label: 'Signals' },
    { id: 'workspace', label: 'Workspace' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* User header */}
      <div className="px-4 py-3 bg-white border-b border-black/8 flex items-center justify-between shrink-0">
        <div>
          <div className="text-[12px] font-semibold text-black truncate max-w-[220px]">{user?.email}</div>
          {currentOrg && (
            <div className="text-[10px] text-black/40 mt-0.5">{currentOrg.name}</div>
          )}
        </div>
        <button
          onClick={signOut}
          className="text-[10px] text-black/40 hover:text-red-500 transition-colors cursor-pointer uppercase tracking-wider shrink-0"
          style={{ fontFamily: "'Departure Mono', monospace" }}
        >
          Sign Out
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex border-b border-black/8 bg-white shrink-0">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex-1 py-2 text-[9px] font-medium uppercase tracking-widest cursor-pointer transition-colors ${
              activeSection === s.id ? 'text-[#1342FF] border-b-2 border-[#1342FF] -mb-px' : 'text-black/30 hover:text-black/50'
            }`}
            style={{ fontFamily: "'Departure Mono', monospace" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* ── General ─────────────────────────────────── */}
        {activeSection === 'general' && (
          <div>
            <label className="block text-[9px] font-medium text-black/40 mb-2 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
              Email Frequency
            </label>
            {settingsLoading ? (
              <div className="h-8 bg-black/5 rounded animate-pulse" />
            ) : (
              <div className="flex flex-col gap-1">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleFreqChange(opt.value)}
                    className={`flex items-center justify-between px-3 h-8 rounded border text-[11px] cursor-pointer transition-all ${
                      emailFreq === opt.value
                        ? 'border-[#1342FF] bg-[#1342FF]/5 text-[#1342FF] font-medium'
                        : 'border-black/8 bg-white text-black/60 hover:border-black/20'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {emailFreq === opt.value && (
                      <span className="text-[9px] text-[#1342FF]" style={{ fontFamily: "'Departure Mono', monospace" }}>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {freqSaving && (
              <p className="text-[10px] text-black/35 mt-1.5" style={{ fontFamily: "'Departure Mono', monospace" }}>Saving…</p>
            )}
          </div>
        )}

        {/* ── Signals ─────────────────────────────────── */}
        {activeSection === 'signals' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-medium text-black/40 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
                Global Signals
              </label>
              <button
                onClick={() => setSignalFormOpen(true)}
                className="text-[9px] text-[#1342FF] hover:text-[#0F35D9] font-semibold cursor-pointer uppercase tracking-wider"
                style={{ fontFamily: "'Departure Mono', monospace" }}
              >
                + New
              </button>
            </div>
            <p className="text-[10px] text-black/35 -mt-2">These run for all tracked companies by default.</p>

            {signalError && <p className="text-red-600 text-[11px]">{signalError}</p>}

            {signalFormOpen && (
              <div className="bg-white border border-[#1342FF]/25 rounded p-3 flex flex-col gap-2">
                <input
                  className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                  placeholder="Signal name"
                  value={signalForm.name}
                  onChange={(e) => setSignalForm((f) => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
                <input
                  className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                  placeholder="Target URL"
                  value={signalForm.target_url}
                  onChange={(e) => setSignalForm((f) => ({ ...f, target_url: e.target.value }))}
                />
                <textarea
                  className="w-full px-2.5 py-2 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none resize-none"
                  placeholder="Search instructions"
                  rows={2}
                  value={signalForm.search_instructions}
                  onChange={(e) => setSignalForm((f) => ({ ...f, search_instructions: e.target.value }))}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateSignal}
                    disabled={!signalForm.name.trim()}
                    className="flex-1 h-7 bg-[#1342FF] disabled:opacity-40 text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-[#0F35D9]"
                    style={{ fontFamily: "'Departure Mono', monospace" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setSignalFormOpen(false); setSignalForm({ name: '', target_url: '', search_instructions: '' }); }}
                    className="flex-1 h-7 bg-black/5 text-black/50 text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-black/10"
                    style={{ fontFamily: "'Departure Mono', monospace" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {signalsLoading ? (
              <div className="flex justify-center py-6">
                <span className="w-4 h-4 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
              </div>
            ) : signals.length === 0 && !signalFormOpen ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1">
                <p className="text-[12px] text-black/40">No global signals yet.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {signals.map((sig) => (
                  <div key={sig.id} className="bg-white border border-black/8 rounded">
                    {editingSignalId === sig.id ? (
                      <div className="p-3 flex flex-col gap-2">
                        <input
                          className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                          placeholder="Signal name"
                          value={editingSignalForm.name}
                          onChange={(e) => setEditingSignalForm((f) => ({ ...f, name: e.target.value }))}
                          autoFocus
                        />
                        <input
                          className="w-full h-8 px-2.5 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                          placeholder="Target URL"
                          value={editingSignalForm.target_url}
                          onChange={(e) => setEditingSignalForm((f) => ({ ...f, target_url: e.target.value }))}
                        />
                        <textarea
                          className="w-full px-2.5 py-2 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none resize-none"
                          placeholder="Search instructions"
                          rows={2}
                          value={editingSignalForm.search_instructions}
                          onChange={(e) => setEditingSignalForm((f) => ({ ...f, search_instructions: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveEditSignal(sig.id)}
                            disabled={!editingSignalForm.name.trim()}
                            className="flex-1 h-7 bg-[#1342FF] disabled:opacity-40 text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-[#0F35D9]"
                            style={{ fontFamily: "'Departure Mono', monospace" }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingSignalId(null)}
                            className="flex-1 h-7 bg-black/5 text-black/50 text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer hover:bg-black/10"
                            style={{ fontFamily: "'Departure Mono', monospace" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-black truncate">{sig.display_name}</div>
                          {sig.target_url && <div className="text-[9px] text-black/35 truncate">{sig.target_url}</div>}
                        </div>
                        <button
                          onClick={() => startEditSignal(sig)}
                          className="text-black/25 hover:text-[#1342FF] transition-colors cursor-pointer shrink-0"
                          title="Edit"
                        >
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M7.5 1.5l2 2L3 10H1V8L7.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDeleteSignal(sig.id)}
                          className="text-black/20 hover:text-red-500 transition-colors cursor-pointer shrink-0"
                          title="Delete"
                        >
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Workspace ─────────────────────────────────── */}
        {activeSection === 'workspace' && (
          <div className="flex flex-col gap-5">

            {/* Switch workspace */}
            {organizations.length > 0 && (
              <div>
                <label className="block text-[9px] font-medium text-black/40 mb-2 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
                  Switch Workspace
                </label>
                <div className="flex flex-col gap-1">
                  {organizations.map((org) => (
                    <button
                      key={org.organization_id}
                      onClick={() => setCurrentOrg(org)}
                      className={`flex items-center justify-between px-3 h-8 rounded border text-[11px] cursor-pointer transition-all ${
                        currentOrg?.organization_id === org.organization_id
                          ? 'border-[#1342FF] bg-[#1342FF]/5 text-[#1342FF] font-medium'
                          : 'border-black/8 bg-white text-black/60 hover:border-black/20'
                      }`}
                    >
                      <span>{org.name}</span>
                      {currentOrg?.organization_id === org.organization_id && (
                        <span className="text-[9px]" style={{ fontFamily: "'Departure Mono', monospace" }}>✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Create workspace */}
            <div>
              <label className="block text-[9px] font-medium text-black/40 mb-2 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
                New Workspace
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-8 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                  placeholder="Workspace name"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateOrg()}
                />
                <button
                  onClick={handleCreateOrg}
                  disabled={orgLoading || !newOrgName.trim()}
                  className="px-3 h-8 bg-[#1342FF] hover:bg-[#0F35D9] disabled:opacity-40 text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer"
                  style={{ fontFamily: "'Departure Mono', monospace" }}
                >
                  Create
                </button>
              </div>
              {orgError && <p className="text-red-600 text-[11px] mt-1">{orgError}</p>}
            </div>

            {/* Members */}
            <div>
              <label className="block text-[9px] font-medium text-black/40 mb-2 uppercase tracking-widest" style={{ fontFamily: "'Departure Mono', monospace" }}>
                Members
              </label>

              {canManage && (
                <div className="flex flex-col gap-1.5 mb-3">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 h-8 px-3 bg-[#F5F5F5] border border-black/10 rounded text-[12px] focus:border-[#1342FF] focus:outline-none"
                      placeholder="email@example.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                    />
                    <button
                      onClick={handleInvite}
                      disabled={inviteLoading || !inviteEmail.trim()}
                      className="px-3 h-8 bg-[#1342FF] hover:bg-[#0F35D9] disabled:opacity-40 text-white text-[9px] font-semibold rounded uppercase tracking-wider cursor-pointer"
                      style={{ fontFamily: "'Departure Mono', monospace" }}
                    >
                      Invite
                    </button>
                  </div>
                  {inviteError && <p className="text-red-600 text-[11px]">{inviteError}</p>}
                  {inviteSuccess && <p className="text-green-600 text-[11px]">{inviteSuccess}</p>}
                </div>
              )}

              {membersLoading ? (
                <div className="flex justify-center py-6">
                  <span className="w-4 h-4 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {members.map((m) => {
                    const isPending = m.status === 'pending';
                    const isOwner = m.role === 'owner';
                    return (
                      <div key={m.id} className="flex items-center justify-between bg-white border border-black/8 rounded px-3 py-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-medium text-black truncate">{m.email || 'Unknown'}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] text-black/35 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
                              {m.role}
                            </span>
                            {isPending && (
                              <span className="text-[9px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
                                Pending
                              </span>
                            )}
                          </div>
                        </div>
                        {canManage && !isOwner && (
                          isPending ? (
                            <button
                              onClick={() => handleCancelInvite(m.id)}
                              className="text-[9px] text-red-500 hover:text-red-700 cursor-pointer font-medium ml-2 shrink-0"
                              style={{ fontFamily: "'Departure Mono', monospace" }}
                            >
                              Cancel
                            </button>
                          ) : (
                            m.user_id && (
                              <button
                                onClick={() => handleRemove(m.user_id!)}
                                className="text-black/20 hover:text-red-500 transition-colors cursor-pointer ml-2 shrink-0"
                              >
                                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                                  <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                                </svg>
                              </button>
                            )
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
