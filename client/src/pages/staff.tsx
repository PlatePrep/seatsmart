import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { DiningTable, Reservation, Room, SeatingPlan, Server, Shift } from "@shared/schema";
import { addDays, dateLabel, minToLabel, toMin } from "@shared/time";
import { nameInitials, serverFor, shiftEnd, shiftOverlaps, shiftStart, shiftTables } from "@shared/staff";
import { useApp } from "@/lib/app-context";
import { errMsg, getJson, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, UserPlus, ArrowRightLeft, AlertTriangle } from "lucide-react";

function autoSize(t: { shape: string; capacity: number }) {
  return t.shape === "rect" ? 11 : t.capacity >= 8 ? 9 : t.capacity >= 4 ? 7 : 6;
}
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const shiftLabel = (s: Shift) => `${minToLabel(shiftStart(s))} – ${s.endTime ? minToLabel(shiftEnd(s)) : "close"}`;

export default function Staff() {
  const { locationId, date, setDate } = useApp();
  const { toast } = useToast();
  const enabled = !!locationId;
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/locations", locationId, "rooms"], enabled });
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: ["/api/locations", locationId, "tables"], enabled });
  const { data: servers = [] } = useQuery<Server[]>({ queryKey: ["/api/locations", locationId, "servers"], enabled });
  const { data: shifts = [] } = useQuery<Shift[]>({
    queryKey: ["/api/locations", locationId, "shifts", date],
    queryFn: () => getJson(`/api/locations/${locationId}/shifts?date=${date}`), enabled,
  });
  const { data: list = [] } = useQuery<Reservation[]>({
    queryKey: ["/api/locations", locationId, "reservations", "date", date],
    queryFn: () => getJson(`/api/locations/${locationId}/reservations?date=${date}`), enabled,
  });
  const { data: plans } = useQuery<{ standard: SeatingPlan; cushion: SeatingPlan }>({
    queryKey: ["/api/locations", locationId, "plan", date],
    queryFn: () => send("POST", `/api/locations/${locationId}/plan/generate`, { date }), enabled,
  });
  const byId = useMemo(() => new Map(list.map((r) => [r.id, r])), [list]);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "servers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "shifts"] });
  };
  const onErr = (e: unknown) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" });

  // roster
  const [newName, setNewName] = useState("");
  const addServer = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/servers`, { name: newName }),
    onSuccess: () => { setNewName(""); refresh(); }, onError: onErr,
  });
  const removeServer = useMutation({ mutationFn: (sid: number) => send("DELETE", `/api/servers/${sid}`), onSuccess: refresh, onError: onErr });

  // shifts
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = shifts.find((s) => s.id === activeId) || null;
  const createShift = useMutation({
    mutationFn: (body: Partial<Shift>) => send<Shift>("POST", `/api/locations/${locationId}/shifts`, { date, ...body }),
    onSuccess: (s) => { setActiveId(s.id); refresh(); }, onError: onErr,
  });
  const patchShift = useMutation({
    mutationFn: ({ sid, body }: { sid: number; body: Partial<Shift> }) => send("PATCH", `/api/shifts/${sid}`, body),
    onSuccess: refresh, onError: onErr,
  });
  const deleteShift = useMutation({ mutationFn: (sid: number) => send("DELETE", `/api/shifts/${sid}`), onSuccess: () => { setActiveId(null); refresh(); }, onError: onErr });
  const copyFrom = useMutation({
    mutationFn: (from: string) => send<{ copied: number }>("POST", `/api/locations/${locationId}/shifts/copy`, { from, to: date }),
    onSuccess: (r) => { toast({ title: `Copied ${r.copied} shift${r.copied === 1 ? "" : "s"}` }); refresh(); }, onError: onErr,
  });

  const addShift = () => {
    if (!servers.length) return toast({ title: "Add a server first", variant: "destructive" });
    const last = shifts[shifts.length - 1];
    const used = new Set(shifts.map((s) => s.serverId));
    const serverId = (servers.find((s) => !used.has(s.id)) || servers[0]).id;
    createShift.mutate({ serverId, startTime: last?.endTime ? hhmm(toMin(last.endTime) + 10) : "09:00", endTime: last ? "" : "17:00" });
  };
  // hand the same tables to the next server 10 minutes after this shift ends
  const handOff = (s: Shift) => {
    const next = servers.find((x) => x.id !== s.serverId) || servers[0];
    const end = s.endTime || "17:00";
    if (!s.endTime) patchShift.mutate({ sid: s.id, body: { endTime: end } });
    createShift.mutate({ serverId: next.id, startTime: hhmm(toMin(end) + 10), endTime: "", tableIds: s.tableIds });
  };

  const toggleTable = (tid: number) => {
    if (!active) return toast({ title: "Pick a shift first", description: "Click a shift on the left, then tap tables to give them to that server." });
    const cur = shiftTables(active);
    const next = cur.includes(tid) ? cur.filter((x) => x !== tid) : [...cur, tid];
    patchShift.mutate({ sid: active.id, body: { tableIds: next.sort((a, b) => a - b).join(",") } });
  };
  const toggleRoom = (on: boolean) => {
    if (!active) return;
    const ids = roomTables.map((x) => x.id);
    const cur = shiftTables(active).filter((x) => !ids.includes(x));
    patchShift.mutate({ sid: active.id, body: { tableIds: (on ? [...cur, ...ids] : cur).sort((a, b) => a - b).join(",") } });
  };

  const [roomId, setRoomId] = useState<number | null>(null);
  const room = rooms.find((r) => r.id === roomId) || rooms[0];
  const roomTables = tables.filter((x) => x.roomId === room?.id && x.active);
  const hasImg = !!room?.imageData;
  const aspect = hasImg && room!.imageW && room!.imageH ? `${room!.imageW} / ${room!.imageH}` : "16 / 11";
  const sv = (sid: number) => servers.find((x) => x.id === sid);
  const label = (tid: number) => tables.find((x) => x.id === tid)?.label || String(tid);

  // coverage checks
  const plan = plans?.standard;
  const uncovered = shifts.length ? (plan?.assignments || []).filter((a) => !a.tableIds.every((t) => serverFor(shifts, servers, t, a.startMin))) : [];
  const overlaps = shiftOverlaps(shifts);
  const covers = (s: Shift) => (plan?.assignments || []).filter((a) => a.startMin >= shiftStart(s) && a.startMin < shiftEnd(s) && a.tableIds.some((t) => shiftTables(s).includes(t)) && serverFor(shifts, servers, a.tableIds[0], a.startMin)?.id === s.serverId)
    .reduce((n, a) => ({ parties: n.parties + 1, covers: n.covers + (byId.get(a.reservationId)?.partySize || 0) }), { parties: 0, covers: 0 });

  return (
    <div>
      <PageHeader title="Servers & sections" sub="Add your wait staff, set who's working and when, then tap tables to give them to each server." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-testid="input-date" />
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-1 text-sm text-muted-foreground">{dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => copyFrom.mutate(addDays(date, -1))} data-testid="button-copy-yesterday"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy yesterday</Button>
          <Button variant="outline" size="sm" onClick={() => copyFrom.mutate(addDays(date, -7))} data-testid="button-copy-last-week"><Copy className="mr-1.5 h-3.5 w-3.5" />Copy same day last week</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4" data-testid="panel-roster">
            <h2 className="mb-2 text-sm font-semibold">Wait staff</h2>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim()) addServer.mutate(); }}>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Server name" data-testid="input-server-name" />
              <Button type="submit" size="sm" disabled={!newName.trim() || addServer.isPending} data-testid="button-add-server"><UserPlus className="mr-1.5 h-3.5 w-3.5" />Add</Button>
            </form>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {servers.length === 0 && <li className="text-sm text-muted-foreground">No servers yet.</li>}
              {servers.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-1.5 text-sm" data-testid={`server-${s.id}`}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: s.color }}>{nameInitials(s.name)}</span>
                  {s.name}
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => removeServer.mutate(s.id)} aria-label={`Remove ${s.name}`} data-testid={`button-remove-server-${s.id}`}><Trash2 className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border bg-card" data-testid="panel-shifts">
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <h2 className="text-sm font-semibold">Shifts ({shifts.length})</h2>
              <Button size="sm" variant="outline" onClick={addShift} disabled={createShift.isPending} data-testid="button-add-shift"><Plus className="mr-1 h-3.5 w-3.5" />Add shift</Button>
            </div>
            {shifts.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No shifts for this day. Add one, or copy from yesterday or last week.</p>}
            <ul className="divide-y">
              {shifts.map((s) => {
                const who = sv(s.serverId);
                const c = covers(s);
                return (
                  <li key={s.id} onClick={() => setActiveId(s.id)}
                    className={cn("cursor-pointer px-4 py-3", activeId === s.id ? "bg-primary/5 ring-2 ring-inset ring-primary" : "hover:bg-muted/50")} data-testid={`shift-${s.id}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: who?.color || "#999" }} />
                      <Select value={String(s.serverId)} onValueChange={(v) => patchShift.mutate({ sid: s.id, body: { serverId: Number(v) } })}>
                        <SelectTrigger className="h-8 flex-1" data-testid={`select-shift-server-${s.id}`}><SelectValue placeholder="Server" /></SelectTrigger>
                        <SelectContent>{servers.map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); deleteShift.mutate(s.id); }} aria-label="Delete shift" data-testid={`button-delete-shift-${s.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <Input type="time" value={s.startTime} onChange={(e) => e.target.value && patchShift.mutate({ sid: s.id, body: { startTime: e.target.value } })} className="h-8 w-[118px]" aria-label="Start" data-testid={`input-shift-start-${s.id}`} />
                      <span className="text-muted-foreground">to</span>
                      {s.endTime ? (
                        <Input type="time" value={s.endTime} onChange={(e) => patchShift.mutate({ sid: s.id, body: { endTime: e.target.value } })} className="h-8 w-[118px]" aria-label="End" data-testid={`input-shift-end-${s.id}`} />
                      ) : <span className="w-[118px] font-medium">Close</span>}
                      <label className="flex items-center gap-1.5 text-xs"><Checkbox checked={!s.endTime} onCheckedChange={(v) => patchShift.mutate({ sid: s.id, body: { endTime: v ? "" : hhmm(Math.min(shiftStart(s) + 8 * 60, 23 * 60 + 45)) } })} data-testid={`check-close-${s.id}`} />Until close</label>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{shiftTables(s).length ? `Tables ${shiftTables(s).map(label).join(", ")}` : "No tables yet. Click this shift, then tap tables on the map."}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Pill t="gray">{c.parties} parties · {c.covers} covers</Pill>
                      {s.endTime && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); handOff(s); }} title="Next server takes the same tables 10 minutes after this shift ends" data-testid={`button-handoff-${s.id}`}><ArrowRightLeft className="mr-1 h-3 w-3" />Hand off tables</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {(overlaps.length > 0 || uncovered.length > 0) && (
            <section className="rounded-lg border border-[hsl(32_80%_45%)]/40 bg-card p-4 text-sm" data-testid="panel-coverage">
              <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4 text-[hsl(32_80%_40%)]" />Coverage check</h2>
              {overlaps.map((o, i) => <p key={i} className="mb-1">{sv(o.a.serverId)?.name} and {sv(o.b.serverId)?.name} both have table {o.tableIds.map(label).join(", ")} at overlapping times. The later shift takes it.</p>)}
              {uncovered.length > 0 && <p className="mb-1 font-medium">{uncovered.length} reservation{uncovered.length === 1 ? " has" : "s have"} no server:</p>}
              <ul className="max-h-48 overflow-auto text-xs text-muted-foreground">
                {uncovered.map((a) => <li key={a.reservationId}>{minToLabel(a.startMin)} · table {a.labels} · {byId.get(a.reservationId)?.guestName} ({byId.get(a.reservationId)?.partySize})</li>)}
              </ul>
            </section>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Rooms">
            {rooms.map((r) => (
              <button key={r.id} role="tab" aria-selected={room?.id === r.id} onClick={() => setRoomId(r.id)}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", room?.id === r.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")} data-testid={`tab-room-${r.id}`}>{r.name}</button>
            ))}
            {active && (
              <span className="ml-auto flex items-center gap-2 text-sm">
                Assigning to <span className="font-semibold" style={{ color: sv(active.serverId)?.color }}>{sv(active.serverId)?.name}</span> · {shiftLabel(active)}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toggleRoom(true)} data-testid="button-whole-room">Whole room</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleRoom(false)} data-testid="button-clear-room">Clear room</Button>
              </span>
            )}
          </div>
          {!active && shifts.length > 0 && <p className="mb-2 text-sm text-muted-foreground">Click a shift on the left, then tap tables to give them to that server.</p>}
          <div className="overflow-x-auto rounded-lg border">
            <div style={{ aspectRatio: aspect }} className={cn("relative w-full min-w-[640px] select-none overflow-hidden bg-card", !hasImg && "bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px)]")} data-testid="canvas-staff">
              {hasImg && <img src={room!.imageData} alt={`${room!.name} floor plan`} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-fill opacity-30" />}
              {roomTables.map((x) => {
                const owners = shifts.filter((s) => shiftTables(s).includes(x.id));
                const mine = !!active && shiftTables(active).includes(x.id);
                const w = x.w || autoSize(x);
                const style: React.CSSProperties = { left: `${x.x}%`, top: `${x.y}%`, width: `${w}%` };
                if (x.h) style.height = `${x.h}%`; else style.aspectRatio = x.shape === "rect" ? "2 / 1" : "1 / 1";
                const shown = active ? (mine ? [active] : []) : owners;
                return (
                  <button key={x.id} type="button" onClick={() => toggleTable(x.id)} style={style}
                    title={`Table ${x.label}` + (owners.length ? "\n" + owners.map((s) => `${sv(s.serverId)?.name} ${shiftLabel(s)}`).join("\n") : " · no server")}
                    className={cn("absolute flex overflow-hidden border-2 bg-card shadow-sm", x.shape === "round" ? "rounded-full" : "rounded-md",
                      mine ? "border-foreground" : "border-foreground/40", active && !mine && owners.length > 0 && "opacity-70")}
                    data-testid={`stable-${x.id}`}>
                    {shown.length === 0 ? (
                      <span className="m-auto flex flex-col items-center leading-tight">
                        <span className="text-[10px] font-semibold">{x.label}</span>
                        {active && owners.length > 0
                          ? <span className="flex gap-0.5">{owners.map((s) => <span key={s.id} className="h-1.5 w-1.5 rounded-full" style={{ background: sv(s.serverId)?.color }} />)}</span>
                          : <span className="text-[9px] text-muted-foreground">{x.capacity}</span>}
                      </span>
                    ) : shown.map((s, i) => (
                      <span key={s.id} className={cn("flex min-w-0 flex-1 flex-col items-center justify-center leading-tight text-white", i > 0 && "border-l border-white/70")} style={{ background: sv(s.serverId)?.color }}>
                        {i === 0 && <span className="text-[9px] font-medium opacity-90">{x.label}</span>}
                        {w / shown.length >= 3.4 && <span className="text-[10px] font-bold">{nameInitials(sv(s.serverId)?.name || "")}</span>}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          </div>
          {servers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {servers.filter((s) => shifts.some((x) => x.serverId === s.id)).map((s) => <span key={s.id} className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
              <span>Split tables = handed off between shifts (left to right in time order).</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
