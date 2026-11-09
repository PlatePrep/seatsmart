import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Block, DiningTable, Room } from "@shared/schema";
import { minToLabel, toMin } from "@shared/time";
import { errMsg, getJson, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Section, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ban, Footprints, Trash2 } from "lucide-react";

export function BlocksManager({ locationId, date }: { locationId: number; date: string }) {
  const { toast } = useToast();
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: ["/api/locations", locationId, "rooms"], enabled: !!locationId });
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: ["/api/locations", locationId, "tables"], enabled: !!locationId });
  const key = ["/api/locations", locationId, "blocks", date];
  const { data: blocks = [] } = useQuery<Block[]>({ queryKey: key, queryFn: () => getJson(`/api/locations/${locationId}/blocks?date=${date}`), enabled: !!locationId });
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<"walkin" | "closed">("walkin");
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("17:00");
  const [to, setTo] = useState("21:00");
  const [note, setNote] = useState("");
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "plan", date] });
    queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "pacing", date] });
    queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "walk"] });
  };
  const add = useMutation({
    mutationFn: () => {
      const [t, idStr] = target.split(":");
      return send("POST", `/api/locations/${locationId}/blocks`, {
        date, roomId: t === "room" ? Number(idStr) : 0, tableId: t === "table" ? Number(idStr) : 0,
        startTime: allDay ? "" : from, endTime: allDay ? "" : to, kind, note,
      });
    },
    onSuccess: () => { refresh(); setNote(""); toast({ title: "Block added", description: "Reservations won't be seated there and it won't show as an opening." }); },
    onError: (e) => toast({ title: "Couldn't add block", description: errMsg(e), variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: (id: number) => send("DELETE", `/api/blocks/${id}`), onSuccess: refresh });
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const tableLabel = new Map(tables.map((t) => [t.id, t.label]));
  const sortedTables = [...tables].sort((a, b) => (roomName.get(a.roomId) || "").localeCompare(roomName.get(b.roomId) || "") || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const when = (b: Block) => (!b.startTime && !b.endTime ? "All day" : `${b.startTime ? minToLabel(toMin(b.startTime)) : "Open"} – ${b.endTime ? minToLabel(toMin(b.endTime)) : "close"}`);

  return (
    <Section title="Blocked tables & rooms" right={<span className="text-xs text-muted-foreground">for this date</span>}>
      {blocks.length > 0 ? (
        <ul className="mb-4 divide-y rounded-md border" data-testid="list-blocks">
          {blocks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm" data-testid={`row-block-${b.id}`}>
              {b.kind === "walkin" ? <Pill t="teal"><Footprints className="h-3 w-3" />Walk-ins only</Pill> : <Pill t="red"><Ban className="h-3 w-3" />Closed</Pill>}
              <span className="font-medium">{b.tableId ? `Table ${tableLabel.get(b.tableId) || b.tableId}` : roomName.get(b.roomId) || "Room"}</span>
              <span className="text-muted-foreground">{when(b)}</span>
              {b.note && <span className="text-muted-foreground">· {b.note}</span>}
              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" aria-label="Remove block" onClick={() => del.mutate(b.id)} data-testid={`button-delete-block-${b.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      ) : <p className="mb-4 text-sm text-muted-foreground">Nothing blocked. Hold a room or table for walk-ins (e.g. patio on Thanksgiving) or close it.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Room or table</Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="mt-1" data-testid="select-block-target"><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              {rooms.map((r) => <SelectItem key={`room:${r.id}`} value={`room:${r.id}`}>Whole room: {r.name}</SelectItem>)}
              {sortedTables.map((t) => <SelectItem key={`table:${t.id}`} value={`table:${t.id}`}>Table {t.label} · {roomName.get(t.roomId) || t.area} ({t.capacity})</SelectItem>)}
            </SelectContent>
          </Select></div>
        <div><Label>Type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger className="mt-1" data-testid="select-block-kind"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="walkin">Walk-ins only</SelectItem><SelectItem value="closed">Closed</SelectItem></SelectContent>
          </Select></div>
        <div><Label>When</Label>
          <Select value={allDay ? "all" : "window"} onValueChange={(v) => setAllDay(v === "all")}>
            <SelectTrigger className="mt-1" data-testid="select-block-when"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All day</SelectItem><SelectItem value="window">Time window</SelectItem></SelectContent>
          </Select></div>
        {!allDay ? (
          <div className="flex items-end gap-2">
            <div className="flex-1"><Label htmlFor="block-from">From</Label><Input id="block-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" data-testid="input-block-from" /></div>
            <div className="flex-1"><Label htmlFor="block-to">To</Label><Input id="block-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" data-testid="input-block-to" /></div>
          </div>
        ) : <div className="hidden sm:block" />}
        <div className="sm:col-span-2"><Label htmlFor="block-note">Note</Label><Input id="block-note" value={note} maxLength={120} placeholder="e.g. Thanksgiving walk-ins" onChange={(e) => setNote(e.target.value)} className="mt-1" data-testid="input-block-note" /></div>
      </div>
      <Button className="mt-3" disabled={!target || add.isPending} onClick={() => add.mutate()} data-testid="button-add-block">Add block</Button>
    </Section>
  );
}
