import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Reservation, SeatingPlan } from "@shared/schema";
import { localToday, minToLabel, timeLabel, dateLabel, toMin } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { getJson, send } from "@/lib/api";
import { PageHeader, Stat, Section, RiskBadge, Empty, Pill } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function nowHHMM() {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return s;
}

export default function Dashboard() {
  const { locationId, location } = useApp();
  const today = localToday();
  const enabled = !!locationId;
  const { data: res = [] } = useQuery<Reservation[]>({
    queryKey: ["/api/locations", locationId, "reservations", "date", today],
    queryFn: () => getJson(`/api/locations/${locationId}/reservations?date=${today}`), enabled,
  });
  const { data: plan } = useQuery<{ standard: SeatingPlan }>({
    queryKey: ["/api/locations", locationId, "plan", today],
    queryFn: () => send("POST", `/api/locations/${locationId}/plan/generate`, { date: today }), enabled,
  });
  const { data: big = [] } = useQuery<any[]>({ queryKey: ["/api/locations", locationId, "confirmations"], enabled });
  const { data: rules } = useQuery<any>({ queryKey: ["/api/locations", locationId, "rules"], enabled });

  const [at, setAt] = useState(nowHHMM());
  const [size, setSize] = useState(2);
  const { data: walk = [], isFetching: walkLoading } = useQuery<any[]>({
    queryKey: ["/api/locations", locationId, "walk", today, at],
    queryFn: () => getJson(`/api/locations/${locationId}/walk-in-availability?date=${today}&at=${at}&windowMin=${size <= 2 ? rules?.turnSmall ?? 75 : size <= 6 ? rules?.turnMid ?? 105 : rules?.turnLarge ?? 120}`),
    enabled: enabled && /^\d{2}:\d{2}$/.test(at),
  });

  const active = res.filter((r) => ["booked", "confirmed", "seated"].includes(r.status));
  const covers = active.reduce((s, r) => s + r.partySize, 0);
  const vips = active.filter((r) => r.visits >= (rules?.vipMinVisits ?? 2)).length;
  const needCard = big.filter((b) => ["no_card", "at_risk"].includes(b.risk));
  const byId = new Map(res.map((r) => [r.id, r]));
  const nowMin = toMin(nowHHMM());
  const upcoming = (plan?.standard.assignments || []).filter((a) => a.startMin >= nowMin - 15).slice(0, 5);
  const turn = size <= 2 ? rules?.turnSmall ?? 75 : size <= 6 ? rules?.turnMid ?? 105 : rules?.turnLarge ?? 120;
  const fits = walk.filter((w) => w.capacity >= size && w.freeFor >= turn).sort((a, b) => a.capacity - b.capacity || (a.area === "inside" ? -1 : 1));

  return (
    <div>
      <PageHeader title="Tonight at a glance" sub={`${location?.name ?? ""} · ${dateLabel(today, { weekday: "long", month: "long", day: "numeric" })}`}
        actions={<Link href="/plan"><Button data-testid="button-open-plan">Open seating plan</Button></Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Reservations" value={active.length} testId="stat-reservations" hint={`${res.filter((r) => r.status === "cancelled").length} cancelled`} />
        <Stat label="Covers" value={covers} testId="stat-covers" />
        <Stat label="Repeat guests" value={vips} testId="stat-vips" hint={`${rules?.vipMinVisits ?? 2}+ visits get inside first`} />
        <Stat label="Big parties need a card" value={needCard.length} testId="stat-need-card" hint={`Parties of ${rules?.cardThreshold ?? 10}+`} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Next seatings" right={<Link href="/plan" className="text-xs text-primary hover:underline">Full plan</Link>}>
          {upcoming.length === 0 ? <Empty title="No more seatings today" /> : (
            <ul className="divide-y">
              {upcoming.map((a) => {
                const r = byId.get(a.reservationId);
                if (!r) return null;
                return (
                  <li key={a.reservationId} className="flex items-center gap-3 py-2.5" data-testid={`row-next-${r.id}`}>
                    <span className="w-16 shrink-0 font-mono text-sm tabular-nums">{minToLabel(a.startMin)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.guestName} <span className="text-muted-foreground">· {r.partySize}</span></div>
                      <div className="truncate text-xs text-muted-foreground">{a.reason}</div>
                    </div>
                    {r.birthday && <Pill t="amber">Birthday</Pill>}
                    <Pill t={a.area === "patio" ? "amber" : "teal"}>{a.labels}</Pill>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Safe to seat a walk-in">
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="walk-size" className="text-xs">Party</Label>
              <Input id="walk-size" type="number" min={1} max={20} value={size} onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-20" data-testid="input-walk-size" /></div>
            <div><Label htmlFor="walk-at" className="text-xs">Time</Label>
              <Input id="walk-at" type="time" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1 w-32" data-testid="input-walk-time" /></div>
            <Button variant="outline" size="sm" onClick={() => setAt(nowHHMM())} data-testid="button-walk-now">Now</Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Needs {turn} min free for a party of {size}.</p>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="list-walk-in">
            {walkLoading ? <span className="text-sm text-muted-foreground">Checking…</span> :
              fits.length === 0 ? <span className="text-sm text-muted-foreground">Nothing free long enough. Offer the bar or a wait.</span> :
              fits.slice(0, 8).map((w) => (
                <Pill key={w.tableId} t={w.area === "patio" ? "amber" : "green"}>
                  {w.label}{w.walkInOnly ? " (held for walk-ins)" : ""} · {w.capacity} seats · {w.freeFor >= 600 ? "rest of night" : `${Math.floor(w.freeFor / 60)}h ${w.freeFor % 60}m`}
                </Pill>
              ))}
          </div>
        </Section>
      </div>

      <div className="mt-5">
        <Section title="Big parties this week" right={<Link href="/confirmations" className="text-xs text-primary hover:underline">Manage</Link>}>
          {big.length === 0 ? <Empty title="No big parties booked" /> : (
            <ul className="divide-y">
              {big.slice(0, 6).map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5" data-testid={`row-big-${b.id}`}>
                  <span className="w-36 shrink-0 text-sm text-muted-foreground">{dateLabel(b.date)} {timeLabel(b.time)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{b.guestName} · {b.partySize}</span>
                  <RiskBadge risk={b.risk} id={b.id} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
