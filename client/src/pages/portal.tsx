import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { dateLabel, timeLabel } from "@shared/time";
import { errMsg, money, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, CreditCard, Lock } from "lucide-react";

type View = {
  guestName: string; partySize: number; date: string; time: string; status: string; requiresCard: boolean; cardStatus: string;
  cardBrand: string; cardLast4: string; restaurant: string; city: string; phone: string; noShowFeeCents: number; threshold: number;
  canModify: boolean; hoursUntil: number; mockMode: boolean;
};

export default function Portal() {
  const params = useParams<{ token: string }>();
  const token = (params.token || "").split("?")[0];
  const key = ["/api/portal", token];
  const { data: v, isLoading, error } = useQuery<View>({ queryKey: key, retry: false });
  const [mode, setMode] = useState<"home" | "card" | "modify">("home");
  const [err, setErr] = useState("");
  const [card, setCard] = useState({ number: "", exp: "", cvc: "", name: "" });
  const [mod, setMod] = useState({ partySize: 0, time: "" });
  const put = (x: View) => { queryClient.setQueryData(key, x); setErr(""); setMode("home"); };

  // returning from Stripe Checkout
  useEffect(() => {
    const m = window.location.hash.match(/session_id=([^&]+)/);
    if (m) send("POST", `/api/portal/${token}/confirm-session`, { sessionId: decodeURIComponent(m[1]) }).then(put).catch((e) => setErr(errMsg(e)));
  }, [token]);
  useEffect(() => { if (v) setMod({ partySize: v.partySize, time: v.time }); }, [v?.partySize, v?.time]);

  const startCard = useMutation({
    mutationFn: () => send("POST", `/api/portal/${token}/checkout`, { returnUrl: `${window.location.href.split("#")[0]}#/r/${token}` }),
    onSuccess: (x: any) => {
      if (x.mode === "mock") { setMode("card"); return; }
      try { window.top!.location.href = x.url; } catch { window.location.href = x.url; }
    },
    onError: (e) => setErr(errMsg(e)),
  });
  const saveCard = useMutation({ mutationFn: () => send("POST", `/api/portal/${token}/mock-card`, card), onSuccess: put, onError: (e) => setErr(errMsg(e)) });
  const saveMod = useMutation({ mutationFn: () => send("POST", `/api/portal/${token}/modify`, mod), onSuccess: put, onError: (e) => setErr(errMsg(e)) });
  const cancel = useMutation({ mutationFn: () => send("POST", `/api/portal/${token}/cancel`), onSuccess: put, onError: (e) => setErr(errMsg(e)) });

  if (isLoading) return <Frame><div className="h-48 animate-pulse rounded-lg bg-muted" /></Frame>;
  if (error || !v) return <Frame><h1 className="text-xl font-semibold">Link not found</h1><p className="mt-2 text-muted-foreground">This link isn't valid. Please call the restaurant.</p></Frame>;

  const cancelled = v.status === "cancelled";
  const onFile = v.cardStatus === "on_file";
  const fee = money(v.noShowFeeCents);
  const fmtNum = (s: string) => s.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim();
  const fmtExp = (s: string) => { const d = s.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  return (
    <Frame name={v.restaurant}>
      <div className="text-sm text-muted-foreground">{v.city}</div>
      <h1 className="mt-1 text-xl font-semibold" data-testid="text-portal-title">{cancelled ? "Reservation cancelled" : `Hi ${v.guestName.split(" ")[0]}, see you soon`}</h1>
      <dl className="mt-4 grid grid-cols-3 gap-3 rounded-lg border bg-card p-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">Date</dt><dd className="font-medium" data-testid="text-portal-date">{dateLabel(v.date, { weekday: "short", month: "short", day: "numeric" })}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Time</dt><dd className="font-medium" data-testid="text-portal-time">{timeLabel(v.time)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Guests</dt><dd className="font-medium" data-testid="text-portal-party">{v.partySize}</dd></div>
      </dl>

      {err && <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="text-portal-error">{err}</p>}

      {!cancelled && v.requiresCard && (
        onFile ? (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-ok/30 bg-ok/5 p-4" data-testid="status-card-saved">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
            <div><div className="font-medium">Card on file: {v.cardBrand.toUpperCase()} ••••{v.cardLast4}</div>
              <p className="text-sm text-muted-foreground">You're all set. Nothing is charged unless the party doesn't show ({fee} per guest).</p></div>
          </div>
        ) : mode === "card" ? (
          <form className="mt-4 space-y-3 rounded-lg border bg-card p-4" onSubmit={(e) => { e.preventDefault(); saveCard.mutate(); }}>
            <div className="flex items-center gap-2 text-sm font-medium"><Lock className="h-4 w-4" />Add a card {v.mockMode && <span className="text-xs font-normal text-muted-foreground">(demo — use 4242 4242 4242 4242)</span>}</div>
            <div><Label htmlFor="cc-name">Name on card</Label><Input id="cc-name" autoComplete="cc-name" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} data-testid="input-card-name" /></div>
            <div><Label htmlFor="cc-num">Card number</Label><Input id="cc-num" inputMode="numeric" autoComplete="cc-number" placeholder="1234 1234 1234 1234" value={card.number} onChange={(e) => setCard({ ...card, number: fmtNum(e.target.value) })} data-testid="input-card-number" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="cc-exp">Expiry</Label><Input id="cc-exp" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={card.exp} onChange={(e) => setCard({ ...card, exp: fmtExp(e.target.value) })} data-testid="input-card-exp" /></div>
              <div><Label htmlFor="cc-cvc">CVC</Label><Input id="cc-cvc" inputMode="numeric" autoComplete="cc-csc" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) })} data-testid="input-card-cvc" /></div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saveCard.isPending} data-testid="button-save-card">Save card</Button>
              <Button type="button" variant="ghost" onClick={() => setMode("home")}>Back</Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 rounded-lg border border-warn/40 bg-warn/5 p-4">
            <div className="font-medium">A card is needed for parties of {v.threshold}+</div>
            <p className="mt-1 text-sm text-muted-foreground">We hold a card on file. It's only charged {fee} per guest if the party doesn't show.</p>
            <Button className="mt-3 w-full" onClick={() => startCard.mutate()} disabled={startCard.isPending} data-testid="button-add-card"><CreditCard className="mr-2 h-4 w-4" />Add credit card</Button>
          </div>
        )
      )}

      {!cancelled && mode === "modify" && (
        <form className="mt-4 space-y-3 rounded-lg border bg-card p-4" onSubmit={(e) => { e.preventDefault(); saveMod.mutate(); }}>
          <div className="text-sm font-medium">Change your reservation</div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="m-size">Guests</Label><Input id="m-size" type="number" min={1} max={60} value={mod.partySize} onChange={(e) => setMod({ ...mod, partySize: Number(e.target.value) })} data-testid="input-modify-party" /></div>
            <div><Label htmlFor="m-time">Time</Label><Input id="m-time" type="time" value={mod.time} onChange={(e) => setMod({ ...mod, time: e.target.value })} data-testid="input-modify-time" /></div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={saveMod.isPending} data-testid="button-save-modify">Save changes</Button>
            <Button type="button" variant="ghost" onClick={() => setMode("home")}>Back</Button>
          </div>
        </form>
      )}

      {!cancelled && mode === "home" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!v.canModify} onClick={() => setMode("modify")} data-testid="button-modify">Change reservation</Button>
          <Button variant="outline" disabled={!v.canModify || cancel.isPending} onClick={() => confirm("Cancel this reservation?") && cancel.mutate()} data-testid="button-cancel-reservation">Cancel</Button>
          {!v.canModify && <p className="col-span-2 text-xs text-muted-foreground">Online changes close 2 hours before your reservation. Call {v.phone || "us"}.</p>}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">Questions? Call {v.restaurant} {v.phone && <a className="underline" href={`tel:${v.phone}`}>{v.phone}</a>}</p>
    </Frame>
  );
}

function Frame({ children, name }: { children: React.ReactNode; name?: string }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card"><div className="mx-auto max-w-md px-5 py-3 text-sm font-semibold tracking-tight">{name || "Reservation"}</div></header>
      <main className="mx-auto max-w-md px-5 py-6">{children}</main>
    </div>
  );
}
