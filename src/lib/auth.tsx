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
  /** Re-pull /auth/me into the in-memory User. Use after an action that
   * mutates profile fields the rest of the app reads (e.g. clearing
   * mustChangePassword after the forced first-login change). */
  refreshSession: () => Promise<void>;
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

  const refreshSession = async () => {
    if (api.hasSession()) await hydrate();
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, signIn, signUp, signOut, refreshSession }}>
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
  | "founder_office" | "settings" | "mail" | "contacts" | "team_attendance"
  | "teams" | "vault" | "documents" | "assets" | "vendors" | "compliance";

// "mail" is intentionally absent from every role for v1 — the IMAP module is
// still Supabase-bound and would throw if anyone clicked it. The Mail.tsx
// route and edge functions stay in the repo so we can flip it back on once
// the FastAPI rebuild lands; just re-add "mail" to whichever roles should
// see it then.
export const roleNavAccess: Record<Role, NavKey[]> = {
  super_admin:                ["dashboard","my_work","projects","tasks","teams","attendance","team_attendance","leave","chat","approvals","reports","people","contacts","documents","vault","assets","vendors","compliance","founder_office","settings"],
  founder:                    ["dashboard","my_work","projects","tasks","teams","attendance","team_attendance","leave","chat","approvals","reports","people","contacts","documents","vault","assets","vendors","compliance","founder_office","settings"],
  founder_office_coordinator: ["dashboard","my_work","projects","tasks","teams","attendance","team_attendance","leave","chat","approvals","reports","people","contacts","documents","vault","assets","vendors","compliance","founder_office","settings"],
  founder_office_support:     ["dashboard","my_work","projects","tasks","teams","attendance","leave","chat","approvals","people","contacts","documents","vault","assets","vendors","compliance","founder_office"],
  manager:                    ["dashboard","my_work","projects","tasks","teams","attendance","leave","chat","approvals","reports","people","contacts","documents"],
  employee:                   ["dashboard","my_work","projects","tasks","teams","attendance","leave","chat","approvals","people","documents"],
  intern:                     ["dashboard","my_work","projects","tasks","teams","attendance","leave","chat","people","documents"],
  hr_admin:                   ["dashboard","my_work","tasks","teams","attendance","team_attendance","leave","chat","approvals","reports","people","contacts","documents","vault","assets","vendors","compliance","settings"],
};

/** Capability check for the Team Attendance / Follow-up page. Roles in
 * the role matrix above always have it; per-user opt-in (granted by HR
 * for TA / recruitment staff who don't have an elevated role) is the
 * second path. AppShell and ProtectedRoute both consult this. */
export function canSeeTeamAttendance(role: Role | null | undefined, u: User | null | undefined): boolean {
  if (role && roleNavAccess[role].includes("team_attendance")) return true;
  return u?.attendanceFollowupAccess === true;
}

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
  // Create / edit a group entity (registration data, addresses, directors,
  // schedule). Mirrors the backend's COMPANY_MANAGE_ROLES — wider than
  // user-management because onboarding new entities is a founder / founder-
  // office / HR responsibility, not just IT. Jayaram + Roja get this via
  // their founder_office_coordinator role.
  manageCompanies: (r: Role) =>
    r === "super_admin" || r === "founder" ||
    r === "founder_office_coordinator" || r === "hr_admin",
  // Finance fields on a company (CIN/GST/PAN/bank). Tighter than basic:
  // HR can fix addresses / phones / logo / schedule but not tax IDs.
  // Mirrors backend COMPANY_EDIT_FINANCE.
  editCompanyFinance: (r: Role) =>
    r === "super_admin" || r === "founder" || r === "founder_office_coordinator",
  // ---------- Contacts ----------
  // Open the Contacts page. Per-category visibility still gates which rows
  // the API actually returns.
  viewContacts: (r: Role) =>
    r === "super_admin" || r === "founder" || r === "founder_office_coordinator" ||
    r === "founder_office_support" || r === "hr_admin" || r === "manager",
  // Create / edit / delete contacts in general. Per-category edit rules
  // (see viewContactCategory + editContactCategory) further restrict this.
  editContacts: (r: Role) =>
    r === "super_admin" || r === "founder" || r === "founder_office_coordinator" || r === "hr_admin",
};

// Mirror of backend CONTACT_CATEGORY_VIEW / _EDIT. Kept in sync by hand —
// the backend is source of truth (it enforces); these helpers only decide
// what to render in the UI so the user isn't shown buttons that would 403.
const CONTACT_CATEGORY_VIEW: Record<string, ReadonlySet<Role>> = {
  ca:            new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin"]),
  cs:            new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin"]),
  auditor:       new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  lawyer:        new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  banker:        new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  insurance:     new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin"]),
  investor:      new Set(["super_admin","founder","founder_office_coordinator"]),
  govt_official: new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  client_poc:      new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
  vendor_poc:      new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
  channel_partner: new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
  collaborator:    new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
  advisor:         new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  mentor:          new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  press:           new Set(["super_admin","founder","founder_office_coordinator"]),
  industry_body:   new Set(["super_admin","founder","founder_office_coordinator","founder_office_support"]),
  college:            new Set(["super_admin","founder","founder_office_coordinator","hr_admin","manager"]),
  tpo:                new Set(["super_admin","founder","founder_office_coordinator","hr_admin","manager"]),
  training_institute: new Set(["super_admin","founder","founder_office_coordinator","hr_admin","manager"]),
  recruitment_agency: new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  domain_registrar: new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin"]),
  hosting_saas:     new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin"]),
  agency:           new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
  other:            new Set(["super_admin","founder","founder_office_coordinator","founder_office_support","hr_admin","manager"]),
};

const CONTACT_CATEGORY_EDIT: Record<string, ReadonlySet<Role>> = {
  ca:            new Set(["super_admin","founder","founder_office_coordinator"]),
  cs:            new Set(["super_admin","founder","founder_office_coordinator"]),
  auditor:       new Set(["super_admin","founder","founder_office_coordinator"]),
  lawyer:        new Set(["super_admin","founder","founder_office_coordinator"]),
  banker:        new Set(["super_admin","founder","founder_office_coordinator"]),
  insurance:     new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  investor:      new Set(["super_admin","founder"]),
  govt_official: new Set(["super_admin","founder","founder_office_coordinator"]),
  client_poc:      new Set(["super_admin","founder","founder_office_coordinator"]),
  vendor_poc:      new Set(["super_admin","founder","founder_office_coordinator"]),
  channel_partner: new Set(["super_admin","founder","founder_office_coordinator"]),
  collaborator:    new Set(["super_admin","founder","founder_office_coordinator"]),
  advisor:         new Set(["super_admin","founder","founder_office_coordinator"]),
  mentor:          new Set(["super_admin","founder","founder_office_coordinator"]),
  press:           new Set(["super_admin","founder","founder_office_coordinator"]),
  industry_body:   new Set(["super_admin","founder","founder_office_coordinator"]),
  college:            new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  tpo:                new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  training_institute: new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  recruitment_agency: new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  domain_registrar: new Set(["super_admin","founder","founder_office_coordinator"]),
  hosting_saas:     new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
  agency:           new Set(["super_admin","founder","founder_office_coordinator"]),
  other:            new Set(["super_admin","founder","founder_office_coordinator","hr_admin"]),
};

export const canViewCategory = (r: Role, c: string): boolean =>
  CONTACT_CATEGORY_VIEW[c]?.has(r) ?? false;
export const canEditCategory = (r: Role, c: string): boolean =>
  CONTACT_CATEGORY_EDIT[c]?.has(r) ?? false;
export const visibleCategories = (r: Role): string[] =>
  Object.keys(CONTACT_CATEGORY_VIEW).filter((c) => CONTACT_CATEGORY_VIEW[c].has(r));

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
