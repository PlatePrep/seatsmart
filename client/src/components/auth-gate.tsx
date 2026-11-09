import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, queryClient, setAuthToken, setUnauthorizedHandler } from "@/lib/queryClient";
import { errMsg, getJson, send } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock } from "lucide-react";

const AuthCtx = createContext<{ signOut: () => void }>({ signOut: () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "in" | "out">("checking");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => { setAuthToken(""); queryClient.clear(); setState("out"); });
    getJson<{ authenticated: boolean }>("/api/auth/status")
      .then((x) => setState(x.authenticated ? "in" : "out"))
      .catch(() => setState("out"));
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const { token } = await send<{ token: string }>("POST", "/api/auth/login", { password: pw });
      setAuthToken(token); setPw(""); setState("in");
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const signOut = () => {
    apiRequest("POST", "/api/auth/logout").catch(() => {});
    setAuthToken(""); queryClient.clear(); setState("out");
  };

  if (state === "checking") return <div className="min-h-dvh bg-background" />;
  if (state === "out") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-5">
        <form onSubmit={signIn} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2 text-primary">
            <Lock className="h-5 w-5" />
            <span className="text-base font-semibold text-foreground">SeatSmart</span>
          </div>
          <h1 className="text-lg font-semibold">Staff sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter the host-stand password.</p>
          <Label htmlFor="pw" className="mt-5 block">Password</Label>
          <Input id="pw" type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1" data-testid="input-password" />
          {err && <p className="mt-2 text-sm text-destructive" data-testid="text-login-error">{err}</p>}
          <Button type="submit" className="mt-4 w-full" disabled={!pw || busy} data-testid="button-sign-in">Sign in</Button>
        </form>
      </div>
    );
  }
  return <AuthCtx.Provider value={{ signOut }}>{children}</AuthCtx.Provider>;
}
