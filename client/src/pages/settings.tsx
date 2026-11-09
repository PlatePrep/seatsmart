import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { setAuthToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Section, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const GROUPS: { title: string; fields: [string, string, boolean?][] }[] = [
  { title: "Stripe (card on file)", fields: [["stripeSecretKey", "Secret key", true], ["stripeWebhookSecret", "Webhook signing secret", true]] },
  { title: "Twilio (SMS)", fields: [["twilioSid", "Account SID"], ["twilioToken", "Auth token", true], ["twilioFrom", "From number"]] },
  { title: "Resend (email)", fields: [["resendKey", "API key", true], ["emailFrom", "From address"]] },
  { title: "Floor-plan reading (OpenAI)", fields: [["openaiKey", "API key", true], ["visionModel", "Vision model"]] },
  { title: "Synthflow (AI calls)", fields: [["synthflowKey", "API key", true], ["synthflowCardAgentId", "Card-reminder agent ID"], ["synthflowAgentId", "Offer-inside agent ID"]] },
];

export default function SettingsPage() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/locations", locationId, "settings"], enabled: !!locationId });
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  const save = useMutation({
    mutationFn: (body: any) => send("PATCH", `/api/locations/${locationId}/settings`, body),
    onSuccess: () => { invalidateLocation(locationId); toast({ title: "Settings saved" }); },
    onError: (e) => toast({ title: "Save failed", description: errMsg(e), variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/settings/test`),
    onSuccess: (x: any) => toast({ title: x.ok ? "Connections OK" : "Check connections", description: x.message, variant: x.ok ? undefined : "destructive" }),
    onError: (e) => toast({ title: "Test failed", description: errMsg(e), variant: "destructive" }),
  });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const changePw = useMutation({
    mutationFn: () => send<{ token: string }>("POST", "/api/auth/password", { current: pw.current, next: pw.next }),
    onSuccess: (x) => { setAuthToken(x.token); setPw({ current: "", next: "", confirm: "" }); toast({ title: "Password changed", description: "Other devices are signed out." }); },
    onError: (e) => toast({ title: "Couldn't change password", description: errMsg(e), variant: "destructive" }),
  });
  if (!f) return <div className="h-60 animate-pulse rounded-lg bg-muted" />;
  const base = (f.publicBaseUrl || window.location.origin).replace(/\/$/, "");
  const hooks = [
    ["Stripe webhook (checkout.session.completed)", `${base}/api/webhooks/stripe/${locationId}`],
    ["Twilio incoming SMS", `${base}/api/webhooks/sms`],
    ["Synthflow call results", `${base}/api/webhooks/synthflow`],
  ];

  return (
    <div>
      <PageHeader title="Settings" actions={<>
        <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-connection">Test connections</Button>
        <Button onClick={() => save.mutate(f)} disabled={save.isPending} data-testid="button-save-settings">Save</Button>
      </>} />
      <div className="space-y-5">
        <section className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
          <Switch checked={f.mockMode} onCheckedChange={(v) => { setF({ ...f, mockMode: v }); save.mutate({ mockMode: v }); }} data-testid="switch-demo-mode" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">Demo mode {f.mockMode ? <Pill t="teal">On</Pill> : <Pill t="red">Live</Pill>}</div>
            <p className="text-sm text-muted-foreground">{f.mockMode ? "Texts, emails, calls and charges are simulated and logged. Guests use a demo card form." : "Real texts, emails and calls go out. Cards are saved through Stripe Checkout."}</p>
          </div>
        </section>
        <Section title="Restaurant">
          <div className="grid gap-3 md:grid-cols-2">
            <div><Label>Name in guest messages</Label><Input value={f.restaurantName} onChange={(e) => setF({ ...f, restaurantName: e.target.value })} data-testid="input-restaurant-name" /></div>
            <div><Label>Public app URL (for guest links)</Label><Input value={f.publicBaseUrl} placeholder="https://seatsmart.yourdomain.com" onChange={(e) => setF({ ...f, publicBaseUrl: e.target.value })} data-testid="input-public-url" /></div>
          </div>
        </Section>
        <div className="grid gap-5 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <Section key={g.title} title={g.title}>
              <div className="space-y-3">
                {g.fields.map(([k, l, secret]) => (
                  <div key={k}><Label htmlFor={k}>{l}</Label>
                    <Input id={k} type={secret ? "password" : "text"} autoComplete="off" value={f[k] || ""} onFocus={(e) => secret && f[k]?.startsWith("••••") && e.target.select()}
                      onChange={(e) => setF({ ...f, [k]: e.target.value })} className="mt-1 font-mono text-sm" data-testid={`input-${k}`} /></div>
                ))}
              </div>
            </Section>
          ))}
        </div>
        <Section title="Staff password">
          <form className="grid gap-3 md:grid-cols-4 md:items-end" onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}>
            <div><Label htmlFor="pw-cur">Current</Label><Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className="mt-1" data-testid="input-pw-current" /></div>
            <div><Label htmlFor="pw-new">New (8+ characters)</Label><Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className="mt-1" data-testid="input-pw-new" /></div>
            <div><Label htmlFor="pw-conf">Confirm new</Label><Input id="pw-conf" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="mt-1" data-testid="input-pw-confirm" /></div>
            <Button type="submit" disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm || changePw.isPending} data-testid="button-change-password">Change password</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">One shared password for the host app. Guest card pages and webhooks don't need it.</p>
        </Section>
        <Section title="Webhook URLs">
          <ul className="space-y-2">
            {hooks.map(([l, u]) => (
              <li key={l}><div className="text-xs text-muted-foreground">{l}</div><Input readOnly value={u} className="font-mono text-xs" data-testid={`input-webhook-${l.split(" ")[0].toLowerCase()}`} /></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">These need a public server URL. The hosted demo can't receive webhooks; run the repo on a server for live mode.</p>
        </Section>
      </div>
    </div>
  );
}
