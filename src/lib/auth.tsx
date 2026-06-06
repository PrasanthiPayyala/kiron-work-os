import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { pickPrimaryRole, mapProfile } from "@/lib/mappers";
import { setCurrentUserId, drainQueue } from "@/lib/offline/mutationQueue";
import { startWs, stopWs } from "@/lib/ws";
import type { User, Role, EmploymentType } from "@/types";

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

  const hydrate = async () => {
    try {
      const { profile, roles } = await api.me();
      const roleList = (roles ?? []) as Role[];
      const primary = pickPrimaryRole(roleList.length ? roleList : ["employee"]);
      const mapped = mapProfile(profile, primary);
      setUser(mapped);
      setRole(primary);
      // Offline queue needs the user id to build optimistic rows; replay any
      // writes that were captured before this session reconnected.
      setCurrentUserId(mapped.id);
      void drainQueue();
      startWs();
    } catch {
      setUser(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (api.hasSession()) hydrate();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      await api.login(email, password);
      await hydrate();
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Login failed" };
    }
  };

  const signUp = async (_email: string, _password: string, _fullName: string) => {
    // Self-service signup is not part of the POC; accounts are seeded/HR-managed.
    return { error: "Signup is disabled — contact your administrator." };
  };

  const signOut = async () => {
    await api.logout();
    setUser(null);
    setRole(null);
    setCurrentUserId(null);
    stopWs();
  };

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
  // Create / edit / deactivate user accounts. Mirrors the backend's
  // USER_MANAGE_ROLES gate so the UI can hide controls the API would reject.
  manageUsers: (r: Role) => r === "super_admin" || r === "hr_admin",
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

export const employmentLabel = (t: EmploymentType): string => {
  const map: Record<EmploymentType, string> = {
    intern: "Intern",
    contract: "Contract",
    full_time: "Full-time",
    temporary: "Temporary",
    part_time: "Part-time",
  };
  return map[t] ?? "Full-time";
};
