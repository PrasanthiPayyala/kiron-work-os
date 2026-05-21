import { Navigate, useLocation } from "react-router-dom";
import { useAuth, roleNavAccess, type NavKey } from "@/lib/auth";
import type { ReactNode } from "react";

export function ProtectedRoute({ children, require }: { children: ReactNode; require?: NavKey }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (require) {
    const allowed = roleNavAccess[user.role];
    if (!allowed.includes(require)) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
