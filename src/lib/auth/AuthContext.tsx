"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Organization } from "@/lib/types";
import { setCurrentOrgId } from "@/lib/api/client";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  currentOrg: Organization | null;
  organizations: Organization[];
  orgLoading: boolean;
  setCurrentOrg: (org: Organization) => void;
  refreshOrgs: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ORG_STORAGE_KEY = "dd_current_org";

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
    localStorage.setItem(ORG_STORAGE_KEY, org.organization_id);
  }, []);

  const initUserAndOrgs = useCallback(async (accessToken: string) => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;
    try {
      const res = await fetch("/api/auth/init", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await res.json();

      if (data.organizations && data.organizations.length > 0) {
        const orgs = data.organizations as Organization[];
        setOrganizations(orgs);

        const savedOrgId = localStorage.getItem(ORG_STORAGE_KEY);
        const savedOrg = savedOrgId ? orgs.find((o) => o.organization_id === savedOrgId) : null;
        const org = savedOrg ?? orgs[0];
        setCurrentOrgState(org);
        setCurrentOrgId(org.organization_id);
      }
    } catch (_initError) {
      setOrgLoading(false);
      return;
    } finally {
      setOrgLoading(false);
    }
  }, []);

  const refreshOrgs = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session: s },
    } = await supabase.auth.getSession();
    if (!s?.access_token) return;

    try {
      const res = await fetch("/api/organizations", {
        headers: { Authorization: `Bearer ${s.access_token}` },
      });
      const orgs = await res.json();
      if (Array.isArray(orgs)) {
        setOrganizations(orgs);
      }
    } catch (_refreshError) {
      return;
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);

      if (s?.access_token) {
        initUserAndOrgs(s.access_token);
      } else {
        setOrgLoading(false);
      }
    }).catch(() => {
      setLoading(false);
      setOrgLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);

      if (s?.access_token) {
        initUserAndOrgs(s.access_token);
      } else {
        setOrganizations([]);
        setCurrentOrgState(null);
        setCurrentOrgId(null);
        setOrgLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [initUserAndOrgs]);

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setOrganizations([]);
    setCurrentOrgState(null);
    setCurrentOrgId(null);
    initCalledRef.current = false;
    localStorage.removeItem(ORG_STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        currentOrg,
        organizations,
        orgLoading,
        setCurrentOrg,
        refreshOrgs,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
