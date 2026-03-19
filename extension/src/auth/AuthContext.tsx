import { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Organization, getOrganizations, setCurrentOrgId } from '../api/client';

const API_BASE = import.meta.env.VITE_API_BASE as string;
const STORAGE_KEY_ORG = 'dd_current_org';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  organizations: Organization[];
  currentOrg: Organization | null;
  orgLoading: boolean;
  setCurrentOrg: (org: Organization) => void;
  refreshOrgs: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const initCalledRef = useRef(false);

  const setCurrentOrg = useCallback((org: Organization) => {
    setCurrentOrgState(org);
    setCurrentOrgId(org.organization_id);
    try {
      chrome.storage.local.set({ [STORAGE_KEY_ORG]: org.organization_id });
    } catch {
      localStorage.setItem(STORAGE_KEY_ORG, org.organization_id);
    }
  }, []);

  const loadOrgs = useCallback(async () => {
    setOrgLoading(true);
    try {
      const orgs = await getOrganizations();
      setOrganizations(orgs);

      let savedOrgId: string | null = null;
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY_ORG);
        savedOrgId = result[STORAGE_KEY_ORG] || null;
      } catch {
        savedOrgId = localStorage.getItem(STORAGE_KEY_ORG);
      }

      const savedOrg = savedOrgId ? orgs.find((o) => o.organization_id === savedOrgId) : null;
      const org = savedOrg || orgs[0] || null;
      if (org) {
        setCurrentOrgState(org);
        setCurrentOrgId(org.organization_id);
      }
    } catch {
      // offline
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const refreshOrgs = useCallback(async () => {
    await loadOrgs();
  }, [loadOrgs]);

  const initUserAndOrgs = useCallback(async (accessToken: string) => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    try {
      await fetch(`${API_BASE}/auth/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      // ignore
    }
    await loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.access_token) {
        try { chrome.storage.local.set({ dd_auth_token: s.access_token }); } catch { /* not in extension */ }
        initUserAndOrgs(s.access_token);
      } else {
        setOrgLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.access_token) {
        try { chrome.storage.local.set({ dd_auth_token: s.access_token }); } catch { /* not in extension */ }
        initUserAndOrgs(s.access_token);
      } else {
        try { chrome.storage.local.remove('dd_auth_token'); } catch { /* not in extension */ }
        setOrganizations([]);
        setCurrentOrgState(null);
        setCurrentOrgId(null);
        setOrgLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [initUserAndOrgs]);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setOrganizations([]);
    setCurrentOrgState(null);
    setCurrentOrgId(null);
    initCalledRef.current = false;
    try {
      chrome.storage.local.remove(STORAGE_KEY_ORG);
    } catch {
      localStorage.removeItem(STORAGE_KEY_ORG);
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, session, loading,
      organizations, currentOrg, orgLoading,
      setCurrentOrg, refreshOrgs,
      signUp, signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
