import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Loader2 } from "lucide-react";

export default function ResetPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/update-password",
    });
    setLoading(false);
    if (error) {
      toast({ title: "Reset failed", description: error.message, variant: "destructive" });
      return;
    }
    setSent(true);
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
            <h1 className="font-display text-3xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter your work email and we'll send you a link to set a new password.
            </p>

            {sent ? (
              <div className="mt-8 space-y-4">
                <div className="rounded-lg border border-border bg-surface-muted p-4">
                  <p className="text-sm font-medium">Check your email for a reset link</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    We sent a reset link to <span className="font-medium text-foreground">{email}</span>. Follow the link to choose a new password.
                  </p>
                </div>
                <div className="text-center">
                  <Link to="/login" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@kirongroup.in"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Send reset link <ArrowRight className="ml-1.5 h-4 w-4" /></>}
                </Button>
                <div className="text-center">
                  <Link to="/login" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </div>

          <footer className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kiron Group · v1 preview
          </footer>
        </div>

        <div className="hidden flex-col justify-between gradient-warm p-12 lg:flex">
          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-surface/70 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Secure account recovery
            </span>
            <h2 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              We'll get you back into your workspace.
            </h2>
            <p className="mt-3 text-sm text-foreground/70">
              Reset links expire after a short window. If you don't see the email within a few minutes, check spam.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
