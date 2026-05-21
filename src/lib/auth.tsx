import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pickPrimaryRole, mapProfile } from "@/lib/mappers";
import type { User, Role } from "@/types";

type AuthContextValue = {
  user: User | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hydrate = async (uid: string) => {
      const [{ data: profile }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);
      const roleList = (roles ?? []).map((r: any) => r.role as Role);
      const primary = pickPrimaryRole(roleList.length ? roleList : ["employee"]);
      if (profile) setUser(mapProfile(profile, primary));
      setRole(primary);
      setLoading(false);
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // defer to avoid deadlock
        setTimeout(() => hydrate(session.user.id), 0);
      } else {
        setUser(null);
        setRole(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) hydrate(session.user.id);
      else setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return error ? { error: error.message } : {};
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---------- Role-based capability map ----------
export type NavKey =
  | "dashboard" | "my_work" | "projects" | "tasks" | "attendance"
  | "leave" | "chat" | "approvals" | "reports" | "people"
  | "founder_office" | "settings" | "mail";

export const roleNavAccess: Record<Role, NavKey[]> = {
  super_admin:                ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","reports","people","founder_office","settings"],
  founder:                    ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","reports","people","founder_office","settings"],
  founder_office_coordinator: ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","reports","people","founder_office","settings"],
  founder_office_support:     ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","people","founder_office"],
  manager:                    ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","reports","people"],
  employee:                   ["dashboard","my_work","projects","tasks","mail","attendance","leave","chat","approvals","people"],
  intern:                     ["dashboard","my_work","projects","tasks","attendance","leave","chat","people"],
  hr_admin:                   ["dashboard","mail","attendance","leave","approvals","reports","people","settings","chat"],
};

export const can = {
  seeFounderOffice: (r: Role) => ["super_admin","founder","founder_office_coordinator","founder_office_support"].includes(r),
  approveLeave: (r: Role) => r === "hr_admin" || r === "super_admin",
  manageRoles: (r: Role) => r === "super_admin",
  reassignTasks: (r: Role) => ["super_admin","founder","founder_office_coordinator","manager","hr_admin"].includes(r),
  createProjects: (r: Role) => r !== "intern",
  approveContent: (r: Role) => ["manager","founder","super_admin","founder_office_coordinator"].includes(r),
};

export const useCurrentCompany = () => {
  const { user } = useAuth();
  return user?.homeCompanyId;
};

// ---------- Role label helper ----------
export const roleLabel = (r: Role): string => {
  const map: Record<Role, string> = {
    super_admin: "Super Admin",
    founder: "Founder",
    founder_office_coordinator: "Founder Office Coordinator",
    founder_office_support: "Founder Office Support",
    manager: "Manager",
    employee: "Employee",
    intern: "Intern",
    hr_admin: "HR Admin",
  };
  return map[r];
};
