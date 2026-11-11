import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Server, Shift } from "@shared/schema";
import { nameInitials, serverFor, shiftFor, shiftTables } from "@shared/staff";
import type { Block, DiningTable, Reservation, Room, SeatingPlan, SeatAssignment } from "@shared/schema";
import { addDays, dateLabel, localToday, minToLabel, toMin } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { getJson, send } from "@/lib/api";
import { PageHeader, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Pause, Play, Pencil, Lock } from "lucide-react";
import { AssignTableDialog } from "@/components/assign-table";

function autoSize(t: { shape: string; capacity: number }) {
  return t.shape === "rect" ? 11 : t.capacity >= 8 ? 9 : t.capacity >= 4 ? 7 : 6;
}
export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z\s'-]/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
const nowMin = () => { const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })); return d.getHours() * 60 + d.getMinutes(); };

// one color per hour of seating, same hour = same color on every table
const HOUR_COLORS: Record<number, [string, string]> = {
  10: ["hsl(190 65% 38%)", "#fff"], 11: ["hsl(230 55% 50%)", "#fff"], 12: ["hsl(198 80% 38%)", "#fff"], 13: ["hsl(142 50% 34%)", "#fff"],
  14: ["hsl(80 55% 42%)", "#111"], 15: ["hsl(45 92% 52%)", "#111"], 16: ["hsl(28 88% 52%)", "#111"], 17: ["hsl(6 70% 48%)", "#fff"],
  18: ["hsl(338 62% 45%)", "#fff"], 19: ["hsl(290 45% 42%)", "#fff"], 20: ["hsl(255 50% 52%)", "#fff"], 21: ["hsl(225 62% 42%)", "#fff"],
  22: ["hsl(215 15% 38%)", "#fff"], 23: ["hsl(0 0% 30%)", "#fff"],
};
export const hourColor = (min: number) => HOUR_COLORS[Math.min(23, Math.max(10, Math.floor(min / 60)))];

type State = { kind: "seated" | "finishing" | "next" | "walkin" | "closed" | "free"; a?: SeatAssignment; res?: Reservation; next?: { a: SeatAssignment; res?: Reservation } };

export default function FloorView() {
  const { locationId, date, setDate } = useApp();
  const enabled = !!locationId;
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/locations", locationId, "rooms"], enabled });
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: ["/api/locations", locationId, "tables"], enabled });
  const { data: list = [] } = useQuery<Reservation[]>({
    queryKey: ["/api/locations", locationId, "reservations", "date", date],
    queryFn: () => getJson(`/api/locations/${locationId}/reservations?date=${date}`), enabled,
  });
  const { data: blocks = [] } = useQuery<Block[]>({ queryKey: ["/api/locations", locationId, "blocks", date], queryFn: () => getJson(`/api/locations/${locationId}/blocks?date=${date}`), enabled });
  const { data: plans } = useQuery<{ standard: SeatingPlan; cushion: SeatingPlan }>({
    queryKey: ["/api/locations", locationId, "plan", date],
    queryFn: () => send("POST", `/api/locations/${locationId}/plan/generate`, { date }), enabled,
  });
  const { data: servers = [] } = useQuery<Server[]>({ queryKey: ["/api/locations", locationId, "servers"], enabled });
  const { data: shifts = [] } = useQuery<Shift[]>({ queryKey: ["/api/locations", locationId, "shifts", date], queryFn: () => getJson(`/api/locations/${locationId}/shifts?date=${date}`), enabled });
  const [cushion, setCushion] = useState(false);
  const [allTimes, setAllTimes] = useState(false);
  const plan = plans ? (cushion ? plans.cushion : plans.standard) : null;
  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);

  // time range for the slider: first booking → last booking end (15-min steps)
  const range = useMemo(() => {
    const as = plan?.assignments || [];
    if (!as.length) return { lo: 17 * 60, hi: 22 * 60 };
    const lo = Math.floor(Math.min(...as.map((a) => a.startMin)) / 15) * 15;
    const hi = Math.ceil(Math.max(...as.map((a) => a.endMin)) / 15) * 15;
    return { lo, hi };
  }, [plan]);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    // new date/plan → today: current time, otherwise first seating
    const n = nowMin();
    setAt(date === localToday() && n >= range.lo && n <= range.hi ? Math.floor(n / 15) * 15 : range.lo);
  }, [date, range.lo, range.hi]);
  const t = at ?? range.lo;
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setAt((v) => { const nv = (v ?? range.lo) + 15; if (nv > range.hi) { setPlaying(false); return range.hi; } return nv; }), 900);
    return () => clearInterval(h);
  }, [playing, range.lo, range.hi]);

  const [roomId, setRoomId] = useState<number | null>(null);
  const room = rooms.find((r) => r.id === roomId) || rooms[0];
  const roomTables = tables.filter((x) => x.roomId === room?.id && x.active);
  const [sel, setSel] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);

  const stateOf = (tb: DiningTable): State => {
    const blk = blocks.find((b) => (b.tableId === tb.id || (!b.tableId && b.roomId === tb.roomId)) && (!b.startTime || toMin(b.startTime) <= t) && (!b.endTime || toMin(b.endTime) > t));
    const mine = (plan?.assignments || []).filter((a) => a.tableIds.includes(tb.id)).sort((x, y) => x.startMin - y.startMin);
    const cur = mine.find((a) => a.startMin <= t && a.endMin > t);
    const nxt = mine.find((a) => a.startMin > t);
    const next = nxt && nxt.startMin - t <= 45 ? { a: nxt, res: byId.get(nxt.reservationId) } : undefined;
    if (cur) return { kind: cur.endMin - t <= 15 ? "finishing" : "seated", a: cur, res: byId.get(cur.reservationId), next };
    if (blk) return { kind: blk.kind === "closed" ? "closed" : "walkin", next };
    if (next) return { kind: "next", next };
    return { kind: "free" };
  };
  const states = new Map(roomTables.map((x) => [x.id, stateOf(x)]));
  const seatedHere = Array.from(new Map(Array.from(states.values()).filter((s) => s.a).map((s) => [s.a!.reservationId, s])).values());
  const coversHere = seatedHere.reduce((s, x) => s + (x.res?.partySize || 0), 0);
  const seatsHere = roomTables.reduce((s, x) => s + x.capacity, 0);
  const arriving = (plan?.assignments || []).filter((a) => a.startMin >= t && a.startMin < t + 30 && a.tableIds.some((id) => roomTables.some((x) => x.id === id))).sort((a, b) => a.startMin - b.startMin);
  const dayOf = (id: number) => (plan?.assignments || []).filter((a) => a.tableIds.includes(id)).sort((a, b) => a.startMin - b.startMin);
  const dayAs = (plan?.assignments || []).filter((a) => a.tableIds.some((id) => roomTables.some((x) => x.id === id)));
  const hoursHere = Array.from(new Set(dayAs.map((a) => Math.min(23, Math.max(10, Math.floor(a.startMin / 60)))))).sort((a, b) => a - b);
  const dayCovers = dayAs.reduce((s, a) => s + (byId.get(a.reservationId)?.partySize || 0), 0);
  const usedTables = roomTables.filter((x) => dayOf(x.id).length > 0).length;
  const hasImg = !!room?.imageData;
  const aspect = hasImg && room!.imageW && room!.imageH ? `${room!.imageW} / ${room!.imageH}` : "16 / 11";
  const selTable = roomTables.find((x) => x.id === sel);
  const selState = selTable ? states.get(selTable.id) : undefined;

  const STYLE: Record<State["kind"], string> = {
    seated: "bg-primary text-primary-foreground border-primary",
    finishing: "bg-warn text-foreground border-[hsl(32_80%_35%)]",
    next: "bg-card border-dashed border-primary text-foreground",
    walkin: "bg-card border-dashed border-foreground/50 text-muted-foreground",
    closed: "bg-muted border-foreground/20 text-muted-foreground opacity-60",
    free: "bg-card border-foreground/40 text-foreground",
  };

  return (
    <div>
      <PageHeader title="Floor view" sub="Who's sitting where at any time. Initials, party size and seated time on each table." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-testid="input-date" />
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-1 text-sm text-muted-foreground">{dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}</span>
        <label className="ml-auto flex items-center gap-2 text-sm"><Switch checked={cushion} onCheckedChange={setCushion} data-testid="switch-cushion" />+{plans?.cushion.cushion ?? 10} min cushion</label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
        <div className="flex rounded-md border p-0.5" role="group" aria-label="View mode">
          <button type="button" onClick={() => setAllTimes(false)} className={cn("rounded px-2.5 py-1 text-sm font-medium", !allTimes ? "bg-primary text-primary-foreground" : "hover:bg-muted")} aria-pressed={!allTimes} data-testid="button-mode-time">One time</button>
          <button type="button" onClick={() => { setPlaying(false); setAllTimes(true); }} className={cn("rounded px-2.5 py-1 text-sm font-medium", allTimes ? "bg-primary text-primary-foreground" : "hover:bg-muted")} aria-pressed={allTimes} data-testid="button-mode-all">All times</button>
        </div>
        {allTimes ? (
          <span className="text-sm text-muted-foreground">Each table is split into one color per seating, left to right in time order. Same color = same hour.</span>
        ) : (<>
        <Button size="icon" variant="outline" onClick={() => { if (t >= range.hi) setAt(range.lo); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Play the night"} data-testid="button-play">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <span className="w-24 whitespace-nowrap font-mono text-lg font-semibold tabular-nums" data-testid="text-time">{minToLabel(t)}</span>
        <Slider value={[t]} min={range.lo} max={range.hi} step={15} onValueChange={(v) => { setPlaying(false); setAt(v[0]); }} className="min-w-[180px] flex-1" aria-label="Time" data-testid="slider-time" />
        <span className="text-xs text-muted-foreground">{minToLabel(range.lo)} – {minToLabel(range.hi)}</span>
        </>)}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Rooms">
        {rooms.map((r) => {
          const n = (plan?.assignments || []).filter((a) => (allTimes || (a.startMin <= t && a.endMin > t)) && a.tableIds.some((id) => tables.find((x) => x.id === id)?.roomId === r.id));
          return (
            <button key={r.id} role="tab" aria-selected={room?.id === r.id} onClick={() => { setRoomId(r.id); setSel(null); }}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", room?.id === r.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              data-testid={`tab-room-${r.id}`}>
              {r.name} <span className={cn("ml-1 text-xs", room?.id === r.id ? "opacity-80" : "text-muted-foreground")}>{n.length} {allTimes ? "parties" : "seated"}</span>
            </button>
          );
        })}
        {allTimes ? (
        <span className="ml-auto flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground" data-testid="legend-hours">
          {hoursHere.map((h) => <span key={h} className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: hourColor(h * 60)[0] }} />{minToLabel(h * 60).replace(":00", "")}</span>)}
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-foreground/40 bg-card" />Unused</span>
        </span>
        ) : (
        <span className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-primary" />Seated</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-warn" />Done in 15 min</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-dashed border-primary" />Arriving soon</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-foreground/40 bg-card" />Open</span>
          <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-dashed border-foreground/50" />Walk-ins only</span>
        </span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 self-start overflow-x-auto rounded-lg border">
          <div style={{ aspectRatio: aspect }} className={cn("relative w-full min-w-[720px] select-none overflow-hidden bg-card", !hasImg && "bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px)]")} data-testid="canvas-floor-view">
            {hasImg && <img src={room!.imageData} alt={`${room!.name} floor plan`} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-30" />}
            {roomTables.map((x) => {
              const s = states.get(x.id)!;
              const w = x.w || autoSize(x);
              const style: React.CSSProperties = { left: `${x.x}%`, top: `${x.y}%`, width: `${w}%` };
              if (x.h) style.height = `${x.h}%`; else style.aspectRatio = x.shape === "rect" ? "2 / 1" : "1 / 1";
              const lead = s.a && s.a.tableIds[0] === x.id; // merged party: details on first table
              if (allTimes) {
                const segs = dayOf(x.id);
                const dayBlock = blocks.some((b) => (b.tableId === x.id || (!b.tableId && b.roomId === x.roomId)));
                const showText = segs.length > 0 && w / segs.length >= 3.4;
                return (
                  <button key={x.id} type="button" onClick={() => setSel(x.id)} style={style}
                    title={`Table ${x.label}` + (segs.length ? "\n" + segs.map((a) => `${minToLabel(a.startMin)}–${minToLabel(a.endMin)} ${byId.get(a.reservationId)?.guestName} (${byId.get(a.reservationId)?.partySize})`).join("\n") : " · no seatings")}
                    className={cn("absolute flex overflow-hidden border-2 bg-card text-center leading-[1.05] shadow-sm", x.shape === "round" ? "rounded-full" : "rounded-md",
                      dayBlock ? "border-dashed border-foreground/50" : "border-foreground/40", segs.some((a) => a.conflict) && "ring-2 ring-destructive", sel === x.id && "ring-2 ring-foreground ring-offset-2")}
                    data-testid={`ftable-${x.id}`}>
                    {segs.length === 0 ? (
                      <span className="m-auto flex flex-col"><span className="text-[9px] font-medium opacity-80">{x.label}</span><span className="text-[10px] opacity-60">{x.capacity}</span></span>
                    ) : segs.map((a, i) => { const [bg, fg] = hourColor(a.startMin); const r = byId.get(a.reservationId); return (
                      <span key={a.reservationId} style={{ background: bg, color: fg }} className={cn("flex min-w-0 flex-1 flex-col items-center justify-center", i > 0 && "border-l border-white/70")}>
                        {showText && <>
                          {i === 0 && <span className="text-[8px] font-medium opacity-90">{x.label}{a.manual && <Lock className="ml-0.5 inline h-2 w-2" />}</span>}
                          <span className="text-[10px] font-bold">{initials(r?.guestName || "")}</span>
                          <span className="text-[8px] tabular-nums">{minToLabel(a.startMin).replace(/ ?[AP]M/, "").replace(":00", "")}</span>
                        </>}
                      </span>); })}
                    {segs.length > 0 && !showText && <span className="pointer-events-none absolute inset-0 m-auto flex h-fit w-fit items-center rounded bg-card/90 px-0.5 text-[9px] font-semibold text-foreground">{x.label}·{segs.length}</span>}
                  </button>
                );
              }
              const srv = serverFor(shifts, servers, x.id, s.a ? s.a.startMin : t); // seated party keeps the server who greeted it
              return (
                <button key={x.id} type="button" onClick={() => setSel(x.id)} style={style}
                  title={(srv ? `Server: ${srv.name}\n` : "") + (s.res ? `${s.res.guestName} (${s.res.partySize}) ${minToLabel(s.a!.startMin)}–${minToLabel(s.a!.endMin)} · table ${s.a!.labels}` : s.next ? `Next: ${s.next.res?.guestName} at ${minToLabel(s.next.a.startMin)}` : `Table ${x.label}`)}
                  className={cn("absolute flex flex-col items-center justify-center overflow-hidden border-2 px-0.5 text-center leading-[1.05] shadow-sm transition-colors",
                    STYLE[s.kind], x.shape === "round" ? "rounded-full" : "rounded-md", s.res?.birthday && "ring-2 ring-[hsl(45_90%_50%)]", s.a?.conflict && "ring-2 ring-destructive", sel === x.id && "ring-2 ring-foreground ring-offset-2")}
                  data-testid={`ftable-${x.id}`}>
                  <span className="text-[9px] font-medium opacity-80">{x.label}{s.a?.manual && <Lock className="ml-0.5 inline h-2 w-2" />}</span>
                  {s.res ? (
                    lead ? (<>
                      <span className="text-[13px] font-bold tracking-tight">{initials(s.res.guestName)}<span className="ml-0.5 text-[10px] font-semibold">·{s.res.partySize}</span></span>
                      <span className="text-[9px] font-medium tabular-nums opacity-90">{minToLabel(s.a!.startMin).replace(/ ?[AP]M/, "")}</span>
                    </>) : <span className="text-[11px] font-bold">{initials(s.res.guestName)}</span>
                  ) : s.kind === "next" && s.next ? (
                    <span className="text-[9px] font-semibold text-primary">{initials(s.next.res?.guestName || "")} {minToLabel(s.next.a.startMin).replace(/ ?[AP]M/, "")}</span>
                  ) : s.kind === "walkin" ? <span className="text-[8px] font-semibold uppercase">walk-in</span>
                    : <span className="text-[10px] opacity-60">{x.capacity}</span>}
                  {srv && <span className="absolute inset-x-0 bottom-0 h-1" style={{ background: srv.color }} aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {allTimes ? (
          <section className="rounded-lg border bg-card p-4" data-testid="panel-room-summary">
            <div className="text-xs text-muted-foreground">{room?.name} · whole day</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{dayCovers}<span className="text-sm font-normal text-muted-foreground"> covers</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill t="teal">{dayAs.length} parties</Pill>
              <Pill t="gray">{usedTables} of {roomTables.length} tables used</Pill>
              <Pill t="gray">{usedTables ? (roomTables.reduce((s, x) => s + dayOf(x.id).length, 0) / usedTables).toFixed(1) : "0"} turns per used table</Pill>
            </div>
          </section>
          ) : (
          <section className="rounded-lg border bg-card p-4" data-testid="panel-room-summary">
            <div className="text-xs text-muted-foreground">{room?.name} at {minToLabel(t)}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{coversHere}<span className="text-sm font-normal text-muted-foreground"> / {seatsHere} seats</span></div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill t="teal">{seatedHere.length} parties</Pill>
              <Pill t="gray">{roomTables.filter((x) => states.get(x.id)?.kind === "free" || states.get(x.id)?.kind === "next").length} tables open</Pill>
            </div>
          </section>
          )}

          {!allTimes && shifts.length > 0 && (() => {
            const on = shifts.filter((sh) => shiftTables(sh).some((tid) => shiftFor(shifts, tid, t)?.id === sh.id));
            return (
              <section className="rounded-lg border bg-card" data-testid="panel-servers">
                <div className="border-b px-4 py-2.5 text-sm font-semibold">Servers on at {minToLabel(t)} ({on.length})</div>
                <ul className="divide-y text-sm">
                  {on.length === 0 && <li className="px-4 py-2 text-muted-foreground">No one on the floor.</li>}
                  {on.map((sh) => {
                    const sv = servers.find((x) => x.id === sh.serverId);
                    const mine = shiftTables(sh).filter((tid) => shiftFor(shifts, tid, t)?.id === sh.id);
                    const seated = (plan?.assignments || []).filter((a) => a.startMin <= t && a.endMin > t && mine.includes(a.tableIds[0]));
                    const cv = seated.reduce((n, a) => n + (byId.get(a.reservationId)?.partySize || 0), 0);
                    return (
                      <li key={sh.id} className="flex items-center gap-2 px-4 py-1.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: sv?.color }}>{nameInitials(sv?.name || "")}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate">{sv?.name}</span><span className="block text-xs text-muted-foreground">{mine.length} tables · {seated.length} parties · {cv} covers seated</span></span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })()}
          {selTable && selState && (
            <section className="rounded-lg border bg-card p-4" data-testid="panel-table">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Table {selTable.label} · {selTable.capacity} seats{!allTimes && serverFor(shifts, servers, selTable.id, t) && <span className="ml-1.5 font-normal" style={{ color: serverFor(shifts, servers, selTable.id, t)!.color }}>· {serverFor(shifts, servers, selTable.id, t)!.name}</span>}</h2>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setSel(null)}>Close</button></div>
              {allTimes ? null : selState.res ? (
                <div className="mt-2 text-sm">
                  <div className="font-medium">{selState.res.guestName} ({selState.res.partySize}){selState.res.birthday && " · birthday"}</div>
                  <div className="text-muted-foreground">{minToLabel(selState.a!.startMin)} – {minToLabel(selState.a!.endMin)} · {selState.a!.labels}</div>
                  {selState.res.visits > 0 && <div className="text-muted-foreground">{selState.res.visits} prior visits</div>}
                  {selState.res.notes && <div className="mt-1 text-xs text-muted-foreground">{selState.res.notes}</div>}
                  {selState.a?.manual && <div className="mt-1 flex items-center gap-1 text-xs"><Lock className="h-3 w-3" />Locked by host</div>}
                  {selState.a?.conflict && <div className="mt-1 text-xs text-destructive">{selState.a.reason}</div>}
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setEditId(selState.res!.id)} data-testid="button-change-table"><Pencil className="mr-1.5 h-3.5 w-3.5" />Change table</Button>
                </div>
              ) : <p className="mt-2 text-sm text-muted-foreground">{selState.kind === "walkin" ? "Held for walk-ins." : selState.kind === "closed" ? "Closed." : "Open now."}</p>}
              {!allTimes && selState.next && <p className="mt-2 text-sm">Next: <span className="font-medium">{selState.next.res?.guestName} ({selState.next.res?.partySize})</span> at {minToLabel(selState.next.a.startMin)}</p>}
              <div className="mt-3 border-t pt-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">All day on this table (click a name to change table)</div>
                {(plan?.assignments || []).filter((a) => a.tableIds.includes(selTable.id)).sort((a, b) => a.startMin - b.startMin).map((a) => (
                  <div key={a.reservationId} className={cn("flex justify-between text-xs", !allTimes && a.startMin <= t && a.endMin > t && "font-semibold")}>
                    <span className="flex items-center gap-1">{allTimes && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: hourColor(a.startMin)[0] }} />}{minToLabel(a.startMin)}–{minToLabel(a.endMin)}</span>
                    <button className="hover:underline" onClick={() => setEditId(a.reservationId)} title="Change table">{byId.get(a.reservationId)?.guestName} ({byId.get(a.reservationId)?.partySize}){(() => { const sv = serverFor(shifts, servers, selTable.id, a.startMin); return sv ? <span className="ml-1" style={{ color: sv.color }}>· {nameInitials(sv.name)}</span> : null; })()}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!allTimes && (<>
          <section className="rounded-lg border bg-card" data-testid="panel-seated">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Seated now ({seatedHere.length})</div>
            <ul className="max-h-64 divide-y overflow-auto text-sm">
              {seatedHere.length === 0 && <li className="px-4 py-2 text-muted-foreground">Nobody seated in this room.</li>}
              {seatedHere.sort((a, b) => a.a!.startMin - b.a!.startMin).map((s) => (
                <li key={s.a!.reservationId} className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-muted" onClick={() => setEditId(s.a!.reservationId)} title="Change table">
                  <span className={cn("w-8 shrink-0 rounded px-1 text-center text-xs font-bold", s.kind === "finishing" ? "bg-warn" : "bg-primary text-primary-foreground")}>{initials(s.res?.guestName || "")}</span>
                  <span className="min-w-0 flex-1 truncate">{s.res?.guestName} ({s.res?.partySize})</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.a!.labels} · out {minToLabel(s.a!.endMin)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border bg-card" data-testid="panel-arriving">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Arriving next 30 min ({arriving.length})</div>
            <ul className="divide-y text-sm">
              {arriving.length === 0 && <li className="px-4 py-2 text-muted-foreground">No arrivals.</li>}
              {arriving.map((a) => (
                <li key={a.reservationId} className="flex cursor-pointer items-center gap-2 px-4 py-1.5 hover:bg-muted" onClick={() => setEditId(a.reservationId)} title="Change table">
                  <span className="w-14 shrink-0 font-mono text-xs tabular-nums">{minToLabel(a.startMin)}</span>
                  <span className="min-w-0 flex-1 truncate">{byId.get(a.reservationId)?.guestName} ({byId.get(a.reservationId)?.partySize})</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.labels}</span>
                </li>
              ))}
            </ul>
          </section>
          </>)}
          {plan && plan.unseated.length > 0 && (
            <section className="rounded-lg border border-destructive/30 bg-card" data-testid="panel-unseated">
              <div className="border-b px-4 py-2.5 text-sm font-semibold text-destructive">Not seated ({plan.unseated.length})</div>
              <ul className="divide-y text-sm">
                {plan.unseated.map((u) => { const x = byId.get(u.reservationId); return (
                  <li key={u.reservationId} className="flex items-center gap-2 px-4 py-1.5">
                    <span className="min-w-0 flex-1 truncate">{x?.guestName} ({x?.partySize}) {x ? minToLabel(toMin(x.time)) : ""}</span>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setEditId(u.reservationId)} data-testid={`button-assign-${u.reservationId}`}>Assign</Button>
                  </li>); })}
              </ul>
            </section>
          )}
          {locationId && <AssignTableDialog locationId={locationId} reservation={editId ? byId.get(editId) || null : null} plan={plan} open={!!editId} onOpenChange={(v) => !v && setEditId(null)} />}
        </div>
      </div>
    </div>
  );
}
