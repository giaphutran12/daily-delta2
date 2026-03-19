import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LoginPage } from '../auth/LoginPage';
import { SignUpPage } from '../auth/SignUpPage';
import { TabBar } from '../components/TabBar';
import { CompaniesTab } from '../tabs/CompaniesTab';
import { ActiveRunsTab } from '../tabs/ActiveRunsTab';
import { ReportsTab } from '../tabs/ReportsTab';
import { SettingsTab } from '../tabs/SettingsTab';
import { ActiveRun } from '../api/client';

type AuthView = 'login' | 'signup';

export function App() {
  const { user, loading } = useAuth();
  const [authView, setAuthView] = useState<AuthView>('login');
  const [activeTab, setActiveTab] = useState('companies');
  const [activeRuns, setActiveRuns] = useState<Record<string, ActiveRun>>({});

  // Load persisted runs from background on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_RUNS' }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.runs) setActiveRuns(response.runs as Record<string, ActiveRun>);
    });

    // Listen for real-time updates from background service worker
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === 'RUN_STARTED' || msg.type === 'RUN_UPDATE') {
        const run = msg.run as ActiveRun | undefined;
        if (run) {
          setActiveRuns((prev) => ({ ...prev, [run.companyId]: run }));
        }
      } else if (msg.type === 'RUN_REMOVED') {
        const companyId = msg.companyId as string | undefined;
        if (companyId) {
          setActiveRuns((prev) => {
            const next = { ...prev };
            delete next[companyId];
            return next;
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F5F5F5]">
        <span className="w-6 h-6 border-2 border-black/10 border-t-[#1342FF] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    if (authView === 'signup') {
      return <SignUpPage onSwitchToLogin={() => setAuthView('login')} />;
    }
    return <LoginPage onSwitchToSignUp={() => setAuthView('signup')} />;
  }

  const activeRunCount = Object.values(activeRuns).filter((r) => !r.isComplete).length;

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#F5F5F5]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 bg-white border-b border-black/8">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-[#1342FF]">
          <span className="text-white font-bold text-sm leading-none" style={{ fontFamily: "'Ubuntu', sans-serif" }}>D</span>
        </div>
        <div>
          <div className="text-[14px] font-semibold text-black leading-none" style={{ fontFamily: "'Ubuntu', sans-serif" }}>
            Daily Delta
          </div>
          <div className="text-[10px] text-black/35 mt-0.5" style={{ fontFamily: "'PT Serif', Georgia, serif" }}>
            Intelligence, daily.
          </div>
        </div>
        {activeRunCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#1342FF] animate-pulse" />
            <span className="text-[9px] text-[#1342FF] font-medium uppercase tracking-wider" style={{ fontFamily: "'Departure Mono', monospace" }}>
              {activeRunCount} running
            </span>
          </div>
        )}
      </div>

      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'companies' && (
          <CompaniesTab activeRuns={activeRuns} />
        )}
        {activeTab === 'runs' && (
          <ActiveRunsTab activeRuns={activeRuns} setActiveRuns={setActiveRuns} />
        )}
        {activeTab === 'reports' && (
          <ReportsTab />
        )}
        {activeTab === 'settings' && (
          <SettingsTab />
        )}
      </div>
    </div>
  );
}
