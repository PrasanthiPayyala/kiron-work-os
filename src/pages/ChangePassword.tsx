// Forced password change on first login. Reached either by the user clicking
// their own "change password" affordance (future) or by AppShell redirecting
// here whenever the authenticated profile has mustChangePassword=true.
//
// Different from UpdatePassword.tsx — that page consumes a reset-link token
// without an active session. Here the user is already signed in, so we ask
// for their current (HR-issued) password before letting them choose a new one.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, refreshSession } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const isForced = user?.mustChangePassword === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please re-enter the same password in both fields.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      toast({ title: "Password updated", description: "You can sign in with the new password from now on." });
      // Re-hydrate the session so mustChangePassword flips to false, then go home.
      await refreshSession();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast({
        title: "Couldn't update password",
        description: err instanceof ApiError ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        <div className="flex flex-col justify-between bg-surface p-8 lg:p-12">
          <header className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-brand text-primary-foreground shadow-card">
              <span className="font-display text-sm font-bold">K</span>
            </div>
            <div>
              <p className="font-display text-base font-semibold leading-tight">Kiron Work OS</p>
              <p className="text-xs text-muted-foreground">Kiron Group · Internal Workspace</p>
            </div>
          </header>

          <div className="mx-auto w-full max-w-md py-12">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3 w-3" />
              {isForced ? "First sign-in" : "Account security"}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {isForced ? "Choose your password" : "Change your password"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isForced
                ? "Your HR team created your account with a temporary password. Pick a new one to continue."
                : "Pick a new password for your Kiron Work OS account."}
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="cur-password">{isForced ? "Temporary password (from HR)" : "Current password"}</Label>
                <Input id="cur-password" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter your current password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input id="confirm-password" type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Update password <ArrowRight className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </form>
          </div>

          <footer className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kiron Group · v1 preview
          </footer>
        </div>

        <div className="hidden flex-col justify-between gradient-warm p-12 lg:flex">
          <div className="max-w-md">
            <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              {isForced ? "Welcome to Kiron Work OS." : "Keep your account secure."}
            </h2>
            <p className="mt-3 text-sm text-foreground/70">
              {isForced
                ? "You'll only see this screen once. After you choose a password, you'll land on your dashboard with your tasks, projects, and chats."
                : "Use at least 6 characters. After updating, you'll stay signed in."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
