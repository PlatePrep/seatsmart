import { useMutation, useQuery } from "@tanstack/react-query";
import type { Reservation, SeatingPlan } from "@shared/schema";
import { addDays, dateLabel, minToLabel } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { errMsg, getJson, invalidateLocation, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill, Empty } from "@/components/common";
import { BlocksManager } from "@/components/blocks-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Printer, PhoneCall, RefreshCw } from "lucide-react";

function PlanTable({ title, plan, byId, onOffer, testId }: { title: string; plan: SeatingPlan; byId: Map<number, Reservation>; onOffer: (id: number) => void; testId: string }) {
  const patio = plan.assignments.filter((a) => a.area === "patio").length;
  const ballroom = plan.assignments.filter((a) => a.area === "ballroom").length;
  return (
    <section className="min-w-0 rounded-lg border bg-card" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex gap-1.5">
          <Pill t="teal">{plan.assignments.length - patio - ballroom} inside</Pill>
          {ballroom > 0 && <Pill t="gray">{ballroom} ballroom</Pill>}
          <Pill t="amber">{patio} patio</Pill>
          {plan.unseated.length > 0 && <Pill t="red">{plan.unseated.length} unseated</Pill>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b"><th className="px-3 py-2">Time</th><th className="px-3 py-2">Guest</th><th className="px-3 py-2 text-right">Party</th><th className="px-3 py-2">Table</th><th className="px-3 py-2">Why</th><th className="print:hidden" /></tr>
          </thead>
          <tbody className="divide-y">
            {plan.assignments.map((a) => {
              const r = byId.get(a.reservationId);
              if (!r) return null;
              return (
                <tr key={a.reservationId} className={cn(r.birthday ? "bg-gold" : a.area === "patio" ? "bg-patio" : "")} data-testid={`row-plan-${testId}-${r.id}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">{minToLabel(a.startMin)}<span className="text-muted-foreground"> – {minToLabel(a.endMin)}</span></td>
                  <td className="px-3 py-2 font-medium">{r.guestName}{r.birthday && <span className="ml-1 text-xs font-normal">(birthday)</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.partySize}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{a.labels}{a.area === "patio" && <span className="ml-1 text-xs font-normal">patio</span>}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.reason}</td>
                  <td className="px-2 py-1 print:hidden">
                    {a.area === "patio" && r.preference !== "patio" && (
                      <Button variant="ghost" size="sm" onClick={() => onOffer(r.id)} data-testid={`button-offer-inside-${r.id}`} title="AI call: offer inside if a table opens"><PhoneCall className="h-3.5 w-3.5" /></Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {plan.unseated.length > 0 && (
        <div className="border-t px-4 py-3 text-sm">
          <div className="mb-1 font-medium text-destructive">Couldn't seat</div>
          {plan.unseated.map((u) => <div key={u.reservationId} className="mb-1"><span className="font-medium">{byId.get(u.reservationId)?.guestName} ({byId.get(u.reservationId)?.partySize})</span>: {u.reason}{u.suggestion && <div className="text-xs text-muted-foreground">Fix: {u.suggestion}</div>}</div>)}
        </div>
      )}
    </section>
  );
}

export default function Plan() {
  const { locationId, date, setDate } = useApp();
  const { toast } = useToast();
  const { data: list = [] } = useQuery<Reservation[]>({
    queryKey: ["/api/locations", locationId, "reservations", "date", date],
    queryFn: () => getJson(`/api/locations/${locationId}/reservations?date=${date}`), enabled: !!locationId,
  });
  const { data: rules } = useQuery<any>({ queryKey: ["/api/locations", locationId, "rules"], enabled: !!locationId });
  const { data, isFetching, refetch } = useQuery<{ standard: SeatingPlan; cushion: SeatingPlan }>({
    queryKey: ["/api/locations", locationId, "plan", date],
    queryFn: () => send("POST", `/api/locations/${locationId}/plan/generate`, { date }), enabled: !!locationId,
  });
  const offer = useMutation({
    mutationFn: (id: number) => send("POST", `/api/reservations/${id}/call-offer-inside`),
    onSuccess: (c: any) => { invalidateLocation(locationId); toast({ title: c.status === "failed" ? "Call failed" : "Call placed", description: c.outcome === "accepted_inside" ? "Guest accepted an inside table (demo)." : c.outcome || "Queued with Synthflow." }); },
    onError: (e) => toast({ title: "Call failed", description: errMsg(e), variant: "destructive" }),
  });
  const byId = new Map(list.map((r) => [r.id, r]));

  return (
    <div>
      <PageHeader title="Seating plan"
        sub={rules ? `Turns ${rules.turnSmall}/${rules.turnMid}/${rules.turnLarge} min · repeat guests (${rules.vipMinVisits}+ visits) first, then latest bookings get inside` : ""}
        actions={<>
          <Button variant="outline" onClick={() => window.print()} data-testid="button-print"><Printer className="mr-1.5 h-4 w-4" />Print</Button>
          <Button onClick={() => refetch()} disabled={isFetching} data-testid="button-generate"><RefreshCw className={cn("mr-1.5 h-4 w-4", isFetching && "animate-spin")} />Generate</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-testid="input-date" />
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm text-muted-foreground">{dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}</span>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border bg-gold" />Birthday</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border bg-patio" />Patio</span>
        </span>
      </div>
      {!data ? <div className="h-60 animate-pulse rounded-lg bg-muted" /> : data.standard.assignments.length + data.standard.unseated.length === 0 ? (
        <Empty title="No reservations to seat on this day" />
      ) : (
        <div className="grid gap-5 2xl:grid-cols-2">
          <PlanTable title="Standard turns" plan={data.standard} byId={byId} onOffer={(id) => offer.mutate(id)} testId="standard" />
          <PlanTable title={`With +${data.cushion.cushion} min cushion`} plan={data.cushion} byId={byId} onOffer={(id) => offer.mutate(id)} testId="cushion" />
        </div>
      )}
      {locationId && <div className="mt-5 print:hidden"><BlocksManager locationId={locationId} date={date} /></div>}
    </div>
  );
}
