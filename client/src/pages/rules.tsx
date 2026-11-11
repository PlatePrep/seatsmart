import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Section, CHANNEL_LABEL } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { PacingByDate } from "@/components/pacing-by-date";

function Num({ label, value, onChange, suffix, id }: { label: string; value: number; onChange: (n: number) => void; suffix?: string; id: string }) {
  return (
    <div><Label htmlFor={id}>{label}</Label>
      <div className="mt-1 flex items-center gap-2"><Input id={id} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-24" data-testid={`input-${id}`} />{suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}</div></div>
  );
}

export default function Rules() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const { data } = useQuery<any>({ queryKey: ["/api/locations", locationId, "rules"], enabled: !!locationId });
  const [f, setF] = useState<any>(null);
  const [cad, setCad] = useState<{ offsetHours: number; channel: string }[]>([]);
  useEffect(() => { if (data) { setF(data); try { setCad(JSON.parse(data.cadence)); } catch { setCad([]); } } }, [data]);
  const save = useMutation({
    mutationFn: () => send("PATCH", `/api/locations/${locationId}/rules`, { ...f, cadence: JSON.stringify([...cad].sort((a, b) => b.offsetHours - a.offsetHours)) }),
    onSuccess: () => { invalidateLocation(locationId); toast({ title: "Rules saved", description: "Upcoming big-party reminders were rescheduled." }); },
    onError: (e) => toast({ title: "Save failed", description: errMsg(e), variant: "destructive" }),
  });
  if (!f) return <div className="h-60 animate-pulse rounded-lg bg-muted" />;
  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));

  return (
    <div>
      <PageHeader title="Rules" actions={<Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-rules">Save rules</Button>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Turn times">
          <div className="grid grid-cols-3 gap-3">
            <Num id="turn-small" label="1–2 guests" value={f.turnSmall} onChange={set("turnSmall")} suffix="min" />
            <Num id="turn-mid" label="3–6 guests" value={f.turnMid} onChange={set("turnMid")} suffix="min" />
            <Num id="turn-large" label="7+ guests" value={f.turnLarge} onChange={set("turnLarge")} suffix="min" />
          </div>
          <div className="mt-4"><Num id="cushion" label="Cushion plan adds" value={f.cushionMin} onChange={set("cushionMin")} suffix="min per table" /></div>
        </Section>
        <Section title="Who gets inside first">
          <Num id="vip-visits" label="Repeat guest after" value={f.vipMinVisits} onChange={set("vipMinVisits")} suffix="visits" />
          <div className="mt-4"><Label>Then</Label>
            <Select value={f.priorityPolicy} onValueChange={set("priorityPolicy")}>
              <SelectTrigger className="mt-1" data-testid="select-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="repeat_then_later">Later bookings get inside first</SelectItem>
                <SelectItem value="repeat_then_earlier">Earlier bookings get inside first</SelectItem>
              </SelectContent>
            </Select></div>
          <p className="mt-3 text-xs text-muted-foreground">Everyone sits inside when there's room. Patio is the fallback. 2-tops and 4-tops in a merge group combine when needed.</p>
        </Section>
        <Section title="Pacing & openings">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Num id="pace-covers" label="Pace cap" value={f.pacingCovers} onChange={set("pacingCovers")} suffix="covers / 15 min" />
            <Num id="avg-spend" label="Avg spend" value={f.avgSpendCents / 100} onChange={(n) => set("avgSpendCents")(Math.round(n * 100))} suffix="$ / guest" />
            <Num id="reset-min" label="Table reset" value={f.resetMin} onChange={set("resetMin")} suffix="min" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><Label htmlFor="service-start">Service start</Label><Input id="service-start" type="time" value={f.serviceStart || ""} onChange={(e) => set("serviceStart")(e.target.value)} className="mt-1 w-36" data-testid="input-service-start" /></div>
            <div><Label htmlFor="last-seating">Last seating</Label><Input id="last-seating" type="time" value={f.lastSeating || ""} onChange={(e) => set("lastSeating")(e.target.value)} className="mt-1 w-36" data-testid="input-last-seating" /></div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm" data-testid="toggle-ballroom">
            <Switch checked={!!f.useBallroom} onCheckedChange={set("useBallroom")} />Use ballroom as overflow (after inside, before patio)
          </label>
          <p className="mt-3 text-xs text-muted-foreground">Blank start/last seating = use first and last booking. Openings never break the pace cap or blocked tables.</p>
          {locationId && <div className="mt-4 border-t pt-4"><PacingByDate locationId={locationId} defaultCovers={data?.pacingCovers ?? f.pacingCovers} /></div>}
        </Section>
        <Section title="Big parties">
          <div className="grid grid-cols-2 gap-3">
            <Num id="card-threshold" label="Card required at" value={f.cardThreshold} onChange={set("cardThreshold")} suffix="guests" />
            <Num id="no-show-fee" label="No-show fee" value={f.noShowFeeCents / 100} onChange={(n) => set("noShowFeeCents")(Math.round(n * 100))} suffix="$ per seat" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Card on file only. Nothing is charged unless you mark a no-show.</p>
        </Section>
        <Section title="Reminder schedule" right={<Button variant="ghost" size="sm" onClick={() => setCad([...cad, { offsetHours: 12, channel: "sms" }])} data-testid="button-add-step"><Plus className="mr-1 h-3.5 w-3.5" />Step</Button>}>
          <ul className="space-y-2">
            {cad.map((c, i) => (
              <li key={i} className="flex items-center gap-2" data-testid={`row-cadence-${i}`}>
                <span className="text-sm text-muted-foreground">T-</span>
                <Input type="number" min={1} value={c.offsetHours} onChange={(e) => setCad(cad.map((x, j) => (j === i ? { ...x, offsetHours: Number(e.target.value) } : x)))} className="w-20" data-testid={`input-offset-${i}`} />
                <span className="text-sm text-muted-foreground">h</span>
                <Select value={c.channel} onValueChange={(v) => setCad(cad.map((x, j) => (j === i ? { ...x, channel: v } : x)))}>
                  <SelectTrigger className="flex-1" data-testid={`select-channel-${i}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{["sms_email", "email", "sms", "voice", "sms_final"].map((k) => <SelectItem key={k} value={k}>{CHANNEL_LABEL[k]}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove step" onClick={() => setCad(cad.filter((_, j) => j !== i))} data-testid={`button-remove-step-${i}`}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Stops as soon as a card is saved or the guest texts STOP.</p>
        </Section>
      </div>
    </div>
  );
}
