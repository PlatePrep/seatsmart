import { useQuery } from "@tanstack/react-query";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, dateLabel } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { getJson, money } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill, Empty } from "@/components/common";
import { BlocksManager } from "@/components/blocks-manager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";

type Risk = { level: "high" | "medium" | "low"; time: string; title: string; detail: string };
type Hole = { startMin: number; time: string; partySize: number; tableId: number; table: string; area: string; room: string; mustLeaveBy: string; nextBooked?: string };
type Slot = { startMin: number; time: string; covers: number; parties: number; seated: number; seatsOpen: number; occupancy: number };
type Pacing = {
  date: string; window: { start: string; last: string };
  metrics: { parties: number; covers: number; seatedCovers: number; unseated: number; utilization: number; turns: number; peak: { time: string; covers: number } | any; holeCovers: number; holeRevenueCents: number; bookedRevenueCents: number; pace: number };
  slots: Slot[]; risks: Risk[]; holes: Hole[]; narrative: string[];
};
const LEVEL = { high: { t: "red", l: "High" }, medium: { t: "amber", l: "Medium" }, low: { t: "gray", l: "Low" } } as const;

function Kpi({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-4 py-3" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function PacingPage() {
  const { locationId, date, setDate } = useApp();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Pacing>({
    queryKey: ["/api/locations", locationId, "pacing", date],
    queryFn: () => getJson(`/api/locations/${locationId}/pacing?date=${date}`), enabled: !!locationId,
  });
  const { data: booked = [] } = useQuery<{ date: string; parties: number; covers: number }[]>({
    queryKey: ["/api/locations", locationId, "booked-dates"], queryFn: () => getJson(`/api/locations/${locationId}/booked-dates`), enabled: !!locationId,
  });
  const groups = new Map<string, Hole[]>();
  for (const h of data?.holes || []) groups.set(h.time, [...(groups.get(h.time) || []), h]);
  const copyHoles = () => {
    const txt = Array.from(groups.entries()).map(([t, hs]) => `${t}: ${hs.map((h) => `${h.partySize}-top (T${h.table}, ${h.room}${h.mustLeaveBy ? `, out by ${h.mustLeaveBy}` : ""})`).join("; ")}`).join("\n");
    navigator.clipboard?.writeText(`Open to sell ${dateLabel(date)}\n${txt}`).then(() => toast({ title: "Copied openings" }), () => toast({ title: "Copy failed", variant: "destructive" }));
  };
  const [view, setView] = useState<"time" | "table">("time");
  const byTable = new Map<number, Hole[]>();
  for (const h of data?.holes || []) byTable.set(h.tableId, [...(byTable.get(h.tableId) || []), h]);
  const tableRows = Array.from(byTable.values()).map((hs) => hs.sort((a, b) => a.startMin - b.startMin))
    .sort((a, b) => a[0].table.localeCompare(b[0].table, undefined, { numeric: true }));
  const peak = data?.metrics.peak;
  const upcoming = booked.filter((b) => b.date !== date).slice(0, 8);

  return (
    <div>
      <PageHeader title="Pacing & openings" sub="How the book flows, where it's at risk, and which tables you can still sell." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-testid="input-date" />
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm text-muted-foreground">{dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}</span>
      </div>
      {upcoming.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5" data-testid="list-booked-dates">
          <span className="self-center text-xs text-muted-foreground">Booked days:</span>
          {upcoming.map((b) => <button key={b.date} onClick={() => setDate(b.date)} className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted" data-testid={`button-date-${b.date}`}>{dateLabel(b.date)} · {b.covers}</button>)}
        </div>
      )}
      {isLoading || !data ? <div className="h-60 animate-pulse rounded-lg bg-muted" /> : data.metrics.parties === 0 ? (
        <div className="space-y-5"><Empty title="No reservations on this day" />{locationId && <BlocksManager locationId={locationId} date={date} />}</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi testId="kpi-covers" label="Booked covers" value={String(data.metrics.covers)} sub={`${data.metrics.parties} parties · ${money(data.metrics.bookedRevenueCents)}`} />
            <Kpi testId="kpi-utilization" label="Seat utilization" value={`${data.metrics.utilization}%`} sub={`${data.window.start} – ${data.window.last}`} />
            <Kpi testId="kpi-turns" label="Turns per seat" value={String(data.metrics.turns)} />
            <Kpi testId="kpi-peak" label="Peak 30 min" value={peak?.covers ? `${peak.covers} covers` : "–"} sub={peak?.covers ? `${peak.time}–${peak.end} · cap ${data.metrics.pace}/15 min` : ""} />
            <Kpi testId="kpi-unseated" label="Unseated" value={String(data.metrics.unseated)} sub={data.metrics.unseated ? "need a fix" : "all placed"} />
            <Kpi testId="kpi-open" label="Open to sell" value={`${data.metrics.holeCovers} covers`} sub={`≈ ${money(data.metrics.holeRevenueCents)} more`} />
          </div>

          <section className="rounded-lg border bg-card p-4" data-testid="section-narrative">
            <h2 className="mb-2 text-sm font-semibold">What the night looks like</h2>
            <div className="space-y-2 text-sm leading-relaxed">{data.narrative.map((p, i) => <p key={i}>{p}</p>)}</div>
          </section>

          <section className="rounded-lg border bg-card p-4" data-testid="section-chart">
            <h2 className="mb-3 text-sm font-semibold">Arrivals every 15 minutes vs. pace cap</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.slots} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis yAxisId="c" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis yAxisId="o" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" width={40} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area yAxisId="o" type="monotone" dataKey="occupancy" name="Seats in use %" fill="hsl(var(--primary) / 0.12)" stroke="hsl(var(--primary) / 0.5)" />
                  <Bar yAxisId="c" dataKey="covers" name="Arriving covers" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <ReferenceLine yAxisId="c" y={data.metrics.pace} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: `cap ${data.metrics.pace}`, fontSize: 11, position: "insideTopRight", fill: "hsl(var(--destructive))" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="min-w-0 rounded-lg border bg-card" data-testid="section-risks">
              <div className="border-b px-4 py-2.5"><h2 className="text-sm font-semibold">Risks ({data.risks.length})</h2></div>
              {data.risks.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No pacing risks found.</p> : (
                <ul className="divide-y">
                  {data.risks.map((r, i) => (
                    <li key={i} className="px-4 py-3" data-testid={`row-risk-${i}`}>
                      <div className="flex flex-wrap items-center gap-2"><Pill t={LEVEL[r.level].t}>{LEVEL[r.level].l}</Pill>{r.time && <span className="font-mono text-xs tabular-nums text-muted-foreground">{r.time}</span>}<span className="text-sm font-medium">{r.title}</span></div>
                      <p className="mt-1 text-sm text-muted-foreground">{r.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="min-w-0 rounded-lg border bg-card" data-testid="section-holes">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <h2 className="text-sm font-semibold">Open to sell ({data.holes.length} seatings on {byTable.size} tables)</h2>
                <div className="ml-auto flex rounded-md border p-0.5 text-xs">
                  {(["time", "table"] as const).map((v) => (
                    <button key={v} onClick={() => setView(v)} className={`rounded px-2 py-1 ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} data-testid={`toggle-holes-${v}`}>By {v}</button>
                  ))}
                </div>
                {data.holes.length > 0 && <Button variant="ghost" size="sm" onClick={copyHoles} data-testid="button-copy-holes"><Copy className="mr-1 h-3.5 w-3.5" />Copy</Button>}
              </div>
              {data.holes.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No sellable openings inside the pace cap.</p> : (
                view === "table" ? (
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b"><th className="px-3 py-2">Table</th><th className="px-3 py-2 text-right">Seats</th><th className="px-3 py-2">Open seatings</th><th className="px-3 py-2">Booked</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {tableRows.map((hs) => (
                        <tr key={hs[0].tableId} data-testid={`row-table-holes-${hs[0].table}`}>
                          <td className="px-3 py-1.5 font-semibold">{hs[0].table}<div className="text-xs font-normal text-muted-foreground">{hs[0].room}</div></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{hs[0].partySize}</td>
                          <td className="px-3 py-1.5">{hs.map((h, k) => <div key={k} className="whitespace-nowrap"><span className="font-mono tabular-nums">{h.time}</span> <span className="text-muted-foreground">out by {h.mustLeaveBy || "end of night"}</span></div>)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{Array.from(new Set(hs.map((h) => h.nextBooked).filter(Boolean))).join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                ) : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr className="border-b"><th className="px-3 py-2">Time</th><th className="px-3 py-2 text-right">Party</th><th className="px-3 py-2">Table</th><th className="px-3 py-2">Room</th><th className="px-3 py-2">Out by</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.holes.map((h, i) => (
                        <tr key={i} data-testid={`row-hole-${i}`}>
                          <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums">{h.time}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{h.partySize}</td>
                          <td className="px-3 py-1.5 font-semibold">{h.table}</td>
                          <td className="px-3 py-1.5">{h.room}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{h.mustLeaveBy || "end of night"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                )
              )}
            </section>
          </div>
          {locationId && <BlocksManager locationId={locationId} date={date} />}
        </div>
      )}
    </div>
  );
}
