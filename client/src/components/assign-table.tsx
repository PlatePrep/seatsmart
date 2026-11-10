import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Block, DiningTable, Reservation, Room, SeatingPlan } from "@shared/schema";
import { minToLabel, toMin } from "@shared/time";
import { errMsg, getJson, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const initials = (n: string) => { const p = n.replace(/[^A-Za-z\s'-]/g, " ").split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() : "?"; };

/** Pick one or more tables for a reservation. Saved tables are locked; the auto plan works around them. */
export function AssignTableDialog({ locationId, reservation, plan, open, onOpenChange }: {
  locationId: number; reservation: Reservation | null; plan: SeatingPlan | null | undefined; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/locations", locationId, "rooms"], enabled: !!locationId });
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: ["/api/locations", locationId, "tables"], enabled: !!locationId });
  const { data: rules } = useQuery<any>({ queryKey: ["/api/locations", locationId, "rules"], enabled: !!locationId });
  const date = reservation?.date || "";
  const { data: blocks = [] } = useQuery<Block[]>({ queryKey: ["/api/locations", locationId, "blocks", date], queryFn: () => getJson(`/api/locations/${locationId}/blocks?date=${date}`), enabled: !!locationId && !!date });
  const mine = plan?.assignments.find((a) => a.reservationId === reservation?.id);
  const [picked, setPicked] = useState<number[]>([]);
  const [roomId, setRoomId] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !reservation) return;
    const ids = mine?.tableIds || [];
    setPicked(ids);
    const t0 = tables.find((t) => t.id === ids[0]);
    setRoomId(t0?.roomId ?? rooms[0]?.id ?? null);
  }, [open, reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (ids: number[]) => send("PATCH", `/api/reservations/${reservation!.id}`, { assignedTables: ids.join(",") }),
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId] });
      toast({ title: ids.length ? "Table assigned" : "Back to auto seating", description: ids.length ? `${reservation!.guestName} is locked to ${ids.map((id) => tables.find((t) => t.id === id)?.label).join("+")}.` : "SeatSmart will pick the table." });
      onOpenChange(false);
    },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  if (!reservation) return null;

  const start = toMin(reservation.time);
  const turn = !rules ? 105 : reservation.partySize <= 2 ? rules.turnSmall : reservation.partySize <= 6 ? rules.turnMid : rules.turnLarge;
  const end = mine ? mine.endMin : start + turn;
  const others = (plan?.assignments || []).filter((a) => a.reservationId !== reservation.id && a.startMin < end && a.endMin > start);
  const occupant = (id: number) => others.find((a) => a.tableIds.includes(id));
  const blockOn = (t: DiningTable) => blocks.find((b) => (b.tableId === t.id || (!b.tableId && b.roomId === t.roomId)) && (!b.startTime || toMin(b.startTime) < end) && (!b.endTime || toMin(b.endTime) > start));
  const seats = picked.reduce((s, id) => s + (tables.find((t) => t.id === id)?.capacity || 0), 0);
  const roomTables = tables.filter((t) => t.active && t.roomId === roomId).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const locked = !!reservation.assignedTables;
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const clashes = picked.filter((id) => occupant(id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign table · {reservation.guestName} ({reservation.partySize})</DialogTitle>
          <DialogDescription>{minToLabel(start)} – {minToLabel(end)}. Now on {mine ? mine.labels : "no table"}{locked ? " (locked by host)" : " (auto)"}. Pick one table, or several to push together.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Rooms">
          {rooms.map((r) => (
            <button key={r.id} role="tab" aria-selected={roomId === r.id} onClick={() => setRoomId(r.id)} data-testid={`assign-room-${r.id}`}
              className={cn("rounded-full border px-3 py-1 text-sm", roomId === r.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{r.name}</button>
          ))}
        </div>
        <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-auto sm:grid-cols-5" data-testid="assign-grid">
          {roomTables.map((t) => {
            const occ = occupant(t.id);
            const blk = blockOn(t);
            const on = picked.includes(t.id);
            const occRes = occ && queryClient.getQueryData<Reservation[]>(["/api/locations", locationId, "reservations", "date", date])?.find((x) => x.id === occ.reservationId);
            return (
              <button key={t.id} type="button" onClick={() => toggle(t.id)} data-testid={`assign-table-${t.id}`}
                className={cn("rounded-md border-2 px-2 py-1.5 text-left text-xs transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : occ ? "border-warn/60 bg-warn/10" : blk ? "border-dashed border-foreground/40 bg-muted" : "border-border hover:border-primary/60")}>
                <div className="flex items-baseline justify-between gap-1"><span className="text-sm font-semibold">{t.label}</span><span className="opacity-70">{t.capacity}</span></div>
                <div className={cn("truncate", !on && "text-muted-foreground")}>
                  {occ ? `${occRes ? initials(occRes.guestName) : "Taken"} ${minToLabel(occ.startMin).replace(/ ?[AP]M/, "")}–${minToLabel(occ.endMin).replace(/ ?[AP]M/, "")}` : blk ? (blk.kind === "closed" ? "Closed" : "Walk-ins") : "Free"}
                </div>
              </button>
            );
          })}
          {roomTables.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No tables in this room.</p>}
        </div>
        <div className="text-sm" data-testid="assign-summary">
          {picked.length === 0 ? <span className="text-muted-foreground">No tables picked.</span> : (
            <span>Picked {picked.map((id) => tables.find((t) => t.id === id)?.label).join(" + ")} · <span className={cn(seats < reservation.partySize && "font-semibold text-destructive")}>{seats} seats</span> for {reservation.partySize}</span>
          )}
          {clashes.length > 0 && <div className="mt-1 text-xs text-[hsl(32_80%_30%)]">Heads up: {clashes.map((id) => tables.find((t) => t.id === id)?.label).join(", ")} already has a party then. The other party will be moved automatically if it isn't locked.</div>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {locked ? <Button variant="ghost" onClick={() => save.mutate([])} disabled={save.isPending} data-testid="button-assign-auto">Let SeatSmart choose</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => save.mutate(picked)} disabled={!picked.length || save.isPending} data-testid="button-assign-save">Lock table</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
