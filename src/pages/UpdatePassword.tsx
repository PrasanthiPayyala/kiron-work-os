import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2 } from "lucide-react";

export default function UpdatePassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // If someone lands here without the token query param, the form can't do
  // anything useful — surface that immediately rather than failing on submit.
  useEffect(() => {
    if (!token) {
      toast({
        title: "Missing reset token",
        description: "Open the reset link from your email — it should include a token.",
        variant: "destructive",
      });
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please re-enter the same password in both fields.", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      // The backend issues fresh access + refresh tokens on success, so we
      // can drop straight into the app without a follow-up sign-in step.
      await api.resetPassword(token, newPassword);
      // Force a hard reload so AuthProvider re-hydrates from the new tokens.
      window.location.assign("/dashboard");
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof ApiError ? err.message : "Could not update your password.",
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
            <h1 className="font-display text-3xl font-semibold tracking-tight">Set a new password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose a new password for your Kiron Work OS account.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !token}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Update password <ArrowRight className="ml-1.5 h-4 w-4" /></>}
              </Button>
              <div className="text-center">
                <Link to="/login" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          </div>

          <footer className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kiron Group · v1 preview
          </footer>
        </div>

        <div className="hidden flex-col justify-between gradient-warm p-12 lg:flex">
          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-surface/70 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Almost done
            </span>
            <h2 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Pick a strong password you'll remember.
            </h2>
            <p className="mt-3 text-sm text-foreground/70">
              Use at least 6 characters. After updating, you'll be signed straight in to your workspace.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
