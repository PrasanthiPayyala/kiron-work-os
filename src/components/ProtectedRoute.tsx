import { Navigate, useLocation } from "react-router-dom";
import { useAuth, roleNavAccess, canSeeTeamAttendance, type NavKey } from "@/lib/auth";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function ProtectedRoute({ children, require }: { children: ReactNode; require?: NavKey }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Auth is still hydrating from localStorage (page refresh / app cold start).
  // Showing a brief splash here prevents a flash redirect to /login that
  // would otherwise drop the user's destination.
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Force the first-login password change. We can't navigate them anywhere
  // useful until they pick a real password, so trap every other route here.
  if (user.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (require) {
    const allowed = roleNavAccess[user.role];
    let permitted = allowed.includes(require);
    // team_attendance has a per-user grant path in addition to role-based
    // access (HR opts TA / recruitment staff in via the profile flag).
    if (!permitted && require === "team_attendance") {
      permitted = canSeeTeamAttendance(user.role, user);
    }
    if (!permitted) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
