import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { dateLabel, timeLabel, relHours } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, money, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, RiskBadge, Section, Pill, Empty, CHANNEL_LABEL, RISK } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Copy, ExternalLink, Send, MessageSquareReply, CreditCard, CheckCircle2, Circle, XCircle, MinusCircle, AlertTriangle } from "lucide-react";

const STEP_ICON: Record<string, any> = { sent: CheckCircle2, scheduled: Circle, cancelled: MinusCircle, skipped: MinusCircle, failed: XCircle };

export default function Confirmations() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const { data: list = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/locations", locationId, "confirmations"], enabled: !!locationId, refetchInterval: 15000 });
  const { data: rules } = useQuery<any>({ queryKey: ["/api/locations", locationId, "rules"], enabled: !!locationId });
  const [selId, setSelId] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");
  const [channel, setChannel] = useState("sms_email");
  const [reply, setReply] = useState("CONFIRM");
  useEffect(() => { if (!selId && list.length) setSelId(list[0].id); }, [list, selId]);
  const r = list.find((x) => x.id === selId);
  const { data: preview } = useQuery<any>({ queryKey: ["/api/reservations", selId, "preview-messages"], enabled: !!selId });

  const ok = (title: string) => () => { invalidateLocation(locationId); toast({ title }); };
  const fail = (e: unknown) => toast({ title: "Something went wrong", description: errMsg(e), variant: "destructive" });
  const resend = useMutation({ mutationFn: () => send("POST", `/api/reservations/${selId}/resend`, { channel }), onSuccess: ok(`${CHANNEL_LABEL[channel]} sent`), onError: fail });
  const simulate = useMutation({
    mutationFn: () => send("POST", `/api/reservations/${selId}/simulate-reply`, { body: reply }),
    onSuccess: (x: any) => ok(x.result === "confirmed" ? "Guest confirmed — card reminders continue until a card is saved" : x.result === "stopped" ? "Guest opted out — all messages stopped" : "Reply logged")(), onError: fail,
  });
  const charge = useMutation({ mutationFn: () => send("POST", `/api/reservations/${selId}/no-show-charge`), onSuccess: ok("No-show fee charged"), onError: fail });

  const counts = Object.fromEntries(Object.keys(RISK).map((k) => [k, list.filter((x) => x.risk === k).length]));
  const shown = list.filter((x) => filter === "all" || x.risk === filter);

  const copy = async () => {
    try { await navigator.clipboard.writeText(r.link); toast({ title: "Guest link copied" }); }
    catch { toast({ title: "Copy blocked", description: r.link }); }
  };

  return (
    <div>
      <PageHeader title="Big-party confirmations"
        sub={rules ? `Parties of ${rules.cardThreshold}+ need a card on file. No-show fee ${money(rules.noShowFeeCents)} per seat. Reminders stop when a card is saved or the guest replies STOP.` : ""} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["all", `All ${list.length}`], ["no_card", `No card ${counts.no_card || 0}`], ["at_risk", `At risk ${counts.at_risk || 0}`], ["pending", `Pending ${counts.pending || 0}`], ["on_file", `On file ${counts.on_file || 0}`]].map(([k, l]) => (
          <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)} data-testid={`filter-${k}`}>{l}</Button>
        ))}
      </div>

      {isLoading ? <div className="h-60 animate-pulse rounded-lg bg-muted" /> : list.length === 0 ? (
        <Empty title="No upcoming big parties">Any reservation of {rules?.cardThreshold ?? 10}+ guests shows up here automatically.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
          <ul className="space-y-2">
            {shown.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setSelId(x.id)} data-testid={`card-party-${x.id}`}
                  className={cn("w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary/40", selId === x.id && "border-primary ring-1 ring-primary")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="truncate font-medium">{x.guestName}</div>
                      <div className="text-xs text-muted-foreground">{dateLabel(x.date)} · {timeLabel(x.time)} · {x.partySize} guests</div></div>
                    <RiskBadge risk={x.risk} id={x.id} />
                  </div>
                  <div className="mt-2 flex gap-1">
                    {x.steps.filter((s: any) => s.channel !== "confirm").map((s: any) => (
                      <span key={s.id} title={`${CHANNEL_LABEL[s.channel]} T-${s.offsetHours}h: ${s.status}`}
                        className={cn("h-1.5 flex-1 rounded-full", s.status === "sent" ? "bg-primary" : s.status === "scheduled" ? "bg-border" : s.status === "failed" ? "bg-destructive" : "bg-muted")} />
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {r && (
            <div className="min-w-0 space-y-4" data-testid="panel-party-detail">
              <section className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{r.guestName}</h2>
                    <p className="text-sm text-muted-foreground">{dateLabel(r.date, { weekday: "long", month: "long", day: "numeric" })} · {timeLabel(r.time)} · party of {r.partySize}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{r.phone || "no phone"} · {r.email || "no email"}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <RiskBadge risk={r.risk} id={`detail-${r.id}`} />
                    {r.status === "confirmed" && <Pill t="teal">Replied CONFIRM</Pill>}
                    {r.cardStatus === "on_file" && <span className="text-sm" data-testid="text-card-on-file">{r.cardBrand.toUpperCase()} ••••{r.cardLast4}</span>}
                    {r.noShowCharged > 0 && <Pill t="red">Charged {money(r.noShowCharged)}</Pill>}
                  </div>
                </div>
                {r.risk === "at_risk" && (
                  <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-2.5 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Under 4 hours out with no card. Call the guest or decide whether to release the table.
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Input readOnly value={r.link} className="min-w-0 flex-1 font-mono text-xs" data-testid="input-guest-link" />
                  <Button variant="outline" size="sm" onClick={copy} data-testid="button-copy-link"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</Button>
                  <Button variant="outline" size="sm" asChild><a href={r.link} target="_blank" rel="noreferrer" data-testid="link-open-guest-page"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Guest page</a></Button>
                </div>
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <Section title="Reminder schedule">
                  <ol className="space-y-2.5">
                    {r.steps.map((s: any) => {
                      const Icon = STEP_ICON[s.status] || Circle;
                      return (
                        <li key={s.id} className="flex items-start gap-2.5 text-sm" data-testid={`step-${s.id}`}>
                          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.status === "sent" ? "text-primary" : s.status === "failed" ? "text-destructive" : "text-muted-foreground")} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{s.channel === "confirm" ? "Card received" : `T-${s.offsetHours}h · ${CHANNEL_LABEL[s.channel]}`}</span>
                              <span className="text-xs text-muted-foreground">{s.status === "sent" ? `sent ${relHours(s.sentAt)}` : s.status === "scheduled" ? relHours(s.sendAt) : s.status}</span></div>
                            {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </Section>

                <Section title="Actions">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Select value={channel} onValueChange={setChannel}>
                        <SelectTrigger className="flex-1" data-testid="select-resend-channel"><SelectValue /></SelectTrigger>
                        <SelectContent>{["sms_email", "sms", "email", "voice", "sms_final"].map((c) => <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button onClick={() => resend.mutate()} disabled={resend.isPending || r.risk === "inactive" || r.optedOut} data-testid="button-resend"><Send className="mr-1.5 h-4 w-4" />Send now</Button>
                    </div>
                    <div className="flex gap-2">
                      <Select value={reply} onValueChange={setReply}>
                        <SelectTrigger className="flex-1" data-testid="select-sim-reply"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="CONFIRM">Guest texts CONFIRM</SelectItem><SelectItem value="STOP">Guest texts STOP</SelectItem><SelectItem value="Running 15 min late">Guest texts other</SelectItem></SelectContent>
                      </Select>
                      <Button variant="outline" onClick={() => simulate.mutate()} disabled={simulate.isPending} data-testid="button-simulate-reply"><MessageSquareReply className="mr-1.5 h-4 w-4" />Simulate</Button>
                    </div>
                    <Button variant="outline" className="w-full border-destructive/30 text-destructive hover:bg-destructive/5"
                      disabled={r.cardStatus !== "on_file" || r.noShowCharged > 0 || charge.isPending}
                      onClick={() => confirm(`Charge ${money((rules?.noShowFeeCents ?? 2500) * r.partySize)} no-show fee to ${r.guestName}?`) && charge.mutate()} data-testid="button-no-show-charge">
                      <CreditCard className="mr-1.5 h-4 w-4" />Mark no-show and charge {money((rules?.noShowFeeCents ?? 2500) * r.partySize)}
                    </Button>
                  </div>
                </Section>
              </div>

              {preview && (
                <Section title="What the guest receives">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[["Reminder text", preview.standard.sms], ["Final text (T-2h)", preview.final.sms], ["After card is saved", preview.confirm.sms], ["AI call script", preview.voice]].map(([l, b]) => (
                      <div key={l}><div className="mb-1 text-xs font-medium text-muted-foreground">{l}</div>
                        <div className="whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm leading-relaxed">{b}</div></div>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Activity">
                {r.events.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
                  <ul className="space-y-2 text-sm">
                    {r.events.map((e: any) => (
                      <li key={e.id} className="flex gap-3"><span className="w-28 shrink-0 text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                        <span className="min-w-0 break-words"><span className="font-medium">{e.type.replace(/_/g, " ")}</span>{e.channel && <span className="text-muted-foreground"> · {e.channel}</span>} <span className="text-muted-foreground">{e.body.length > 140 ? e.body.slice(0, 140) + "…" : e.body}</span></span></li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
