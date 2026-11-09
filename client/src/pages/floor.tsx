import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { DiningTable, Room } from "@shared/schema";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { readFloorPlanFile } from "@/lib/floorplan-file";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Section, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ImagePlus, Plus, ScanSearch, Trash2, X } from "lucide-react";

const AREA_STYLE: Record<string, string> = {
  inside: "bg-card border-foreground/70",
  patio: "bg-patio border-foreground/40",
  bar: "bg-muted border-foreground/30",
  ballroom: "bg-gold border-foreground/40",
};
const AREAS = ["inside", "patio", "bar", "ballroom"] as const;
const AREA_LABEL: Record<string, string> = { inside: "Inside", patio: "Patio", bar: "Bar", ballroom: "Ballroom" };

type Detected = { label: string; capacity: number; shape: "square" | "round" | "rect"; area: string; x: number; y: number; w: number; h: number };

function autoSize(t: { shape: string; capacity: number }) {
  return t.shape === "rect" ? 11 : t.capacity >= 8 ? 9 : t.capacity >= 4 ? 7 : 6;
}

export default function FloorPlan() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const tKey = ["/api/locations", locationId, "tables"];
  const rKey = ["/api/locations", locationId, "rooms"];
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: tKey, enabled: !!locationId });
  const { data: rooms = [] } = useQuery<Room[]>({ queryKey: rKey, enabled: !!locationId });
  const [roomId, setRoomId] = useState<number | null>(null);
  const room = rooms.find((r) => r.id === roomId) || rooms[0];
  useEffect(() => { if (rooms.length && !rooms.some((r) => r.id === roomId)) setRoomId(rooms[0].id); }, [rooms, roomId]);

  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const [opacity, setOpacity] = useState(70);
  const [busy, setBusy] = useState("");
  const [found, setFound] = useState<Detected[] | null>(null);
  const [newRoom, setNewRoom] = useState<{ name: string; area: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const refresh = () => { invalidateLocation(locationId); queryClient.invalidateQueries({ queryKey: rKey }); };
  const fail = (title: string) => (e: unknown) => toast({ title, description: errMsg(e), variant: "destructive" });

  const patch = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DiningTable> }) => send("PATCH", `/api/tables/${id}`, data),
    onMutate: ({ id, data }) => queryClient.setQueryData<DiningTable[]>(tKey, (old) => old?.map((t) => (t.id === id ? { ...t, ...data } : t))),
    onSettled: () => invalidateLocation(locationId),
    onError: fail("Save failed"),
  });
  const add = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/tables/add`, { label: `T${tables.length + 1}`, capacity: 4, area: room?.area || "inside", shape: "square", roomId: room?.id }),
    onSuccess: (t: DiningTable) => { invalidateLocation(locationId); setSel(t.id); },
    onError: fail("Couldn't add table"),
  });
  const del = useMutation({
    mutationFn: (id: number) => send("DELETE", `/api/tables/${id}`),
    onSuccess: () => { invalidateLocation(locationId); setSel(null); },
  });
  const patchRoom = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Room> }) => send("PATCH", `/api/rooms/${id}`, data),
    onSuccess: refresh,
    onError: fail("Couldn't save room"),
  });
  const createRoom = useMutation({
    mutationFn: (b: { name: string; area: string }) => send<Room>("POST", `/api/locations/${locationId}/rooms`, b),
    onSuccess: (r) => { queryClient.setQueryData<Room[]>(rKey, (old) => [...(old || []), r]); setRoomId(r.id); setNewRoom(null); refresh(); },
    onError: fail("Couldn't add room"),
  });
  const deleteRoom = useMutation({
    mutationFn: (id: number) => send("DELETE", `/api/rooms/${id}`),
    onSuccess: () => { refresh(); setRoomId(null); },
    onError: fail("Couldn't delete room"),
  });
  const detect = useMutation({
    mutationFn: () => send<{ tables: Detected[] }>("POST", `/api/rooms/${room!.id}/detect`),
    onSuccess: (x) => { setFound(x.tables); if (!x.tables.length) toast({ title: "No tables found", description: "Try a clearer, straight-on image." }); },
    onError: fail("Couldn't read tables"),
  });
  const addFound = useMutation({
    mutationFn: (replace: boolean) => send("POST", `/api/rooms/${room!.id}/tables`, { replace, tables: found }),
    onSuccess: (x: any[]) => { refresh(); setFound(null); toast({ title: `Added ${x.length} tables`, description: "Check seats and merge groups, then drag to fine-tune." }); },
    onError: fail("Couldn't add tables"),
  });

  async function onFile(f: File | undefined) {
    if (!f || !room) return;
    setBusy("Reading file…");
    try {
      const img = await readFloorPlanFile(f);
      await send("PATCH", `/api/rooms/${room.id}`, { imageData: img.dataUrl, imageW: img.width, imageH: img.height });
      refresh();
      toast({ title: "Floor plan uploaded", description: `${room.name}: place tables on top of it, or use Read tables.` });
    } catch (e) {
      fail("Upload failed")(e);
    } finally {
      setBusy("");
      if (file.current) file.current.value = "";
    }
  }

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      moved.current = true;
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: Math.max(0, Math.min(98, ((e.clientX - r.left) / r.width) * 100 - 3)), y: Math.max(0, Math.min(98, ((e.clientY - r.top) / r.height) * 100 - 4)) };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d && moved.current) patch.mutate({ id: d.id, data: { x: Math.round(d.x), y: Math.round(d.y) } });
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag?.id]);

  const roomTables = tables.filter((x) => room && (x.roomId === room.id || (!x.roomId && room.id === rooms[0]?.id)));
  const t = tables.find((x) => x.id === sel);
  const seats = tables.filter((x) => x.active && (x.area === "inside" || x.area === "patio"));
  const groups = Array.from(new Set(roomTables.map((x) => x.mergeGroup).filter(Boolean)));
  const hasImg = !!room?.imageData;
  const aspect = hasImg && room!.imageW && room!.imageH ? `${room!.imageW} / ${room!.imageH}` : "16 / 11";
  const seatsIn = (list: DiningTable[]) => list.filter((x) => x.active).reduce((s, x) => s + x.capacity, 0);

  return (
    <div>
      <PageHeader title="Floor plan"
        sub={`${seats.length} bookable tables · ${seats.filter((x) => x.area === "inside").reduce((s, x) => s + x.capacity, 0)} inside seats · ${seats.filter((x) => x.area === "patio").reduce((s, x) => s + x.capacity, 0)} patio seats. Upload a screenshot, photo or PDF for each room.`}
        actions={<Button onClick={() => add.mutate()} disabled={!room} data-testid="button-add-table"><Plus className="mr-1.5 h-4 w-4" />Add table</Button>} />

      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Rooms">
        {rooms.map((r) => {
          const list = tables.filter((x) => x.roomId === r.id);
          return (
            <button key={r.id} role="tab" aria-selected={room?.id === r.id} onClick={() => { setRoomId(r.id); setSel(null); setFound(null); }}
              className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition-colors", room?.id === r.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              data-testid={`tab-room-${r.id}`}>
              {r.name} <span className={cn("ml-1 text-xs", room?.id === r.id ? "opacity-80" : "text-muted-foreground")}>{list.length} · {seatsIn(list)} seats</span>
            </button>
          );
        })}
        {newRoom ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); newRoom.name.trim() && createRoom.mutate({ name: newRoom.name.trim(), area: newRoom.area }); }}>
            <Input autoFocus placeholder="Room name" value={newRoom.name} onChange={(e) => setNewRoom({ ...newRoom, name: e.target.value })} className="h-8 w-40" data-testid="input-room-name" />
            <Select value={newRoom.area} onValueChange={(v) => setNewRoom({ ...newRoom, area: v })}>
              <SelectTrigger className="h-8 w-32" data-testid="select-room-area"><SelectValue /></SelectTrigger>
              <SelectContent>{AREAS.map((a) => <SelectItem key={a} value={a}>{AREA_LABEL[a]}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" type="submit" disabled={createRoom.isPending} data-testid="button-save-room">Add</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setNewRoom(null)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setNewRoom({ name: "", area: "inside" })} data-testid="button-add-room"><Plus className="mr-1 h-3.5 w-3.5" />Room</Button>
        )}
      </div>

      {room && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <input ref={file} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="input-floorplan-file" />
          <Button size="sm" variant={hasImg ? "outline" : "default"} onClick={() => file.current?.click()} disabled={!!busy} data-testid="button-upload-plan">
            <ImagePlus className="mr-1.5 h-4 w-4" />{busy || (hasImg ? "Replace plan" : "Upload floor plan")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => detect.mutate()} disabled={!hasImg || detect.isPending} data-testid="button-detect">
            <ScanSearch className="mr-1.5 h-4 w-4" />{detect.isPending ? "Reading tables…" : "Read tables"}
          </Button>
          {hasImg && (
            <>
              <div className="flex items-center gap-2 pl-1">
                <span className="text-xs text-muted-foreground">Image</span>
                <Slider value={[opacity]} min={0} max={100} step={5} onValueChange={(v) => setOpacity(v[0])} className="w-24" aria-label="Image opacity" data-testid="slider-opacity" />
              </div>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Remove the floor-plan image from ${room.name}? Tables stay.`) && patchRoom.mutate({ id: room.id, data: { imageData: "", imageW: 0, imageH: 0 } })} data-testid="button-remove-image">Remove image</Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Select value={room.area} onValueChange={(v) => patchRoom.mutate({ id: room.id, data: { area: v } })}>
              <SelectTrigger className="h-8 w-32" aria-label="Default area for new tables" data-testid="select-room-default-area"><SelectValue /></SelectTrigger>
              <SelectContent>{AREAS.map((a) => <SelectItem key={a} value={a}>{AREA_LABEL[a]}</SelectItem>)}</SelectContent>
            </Select>
            {rooms.length > 1 && (
              <Button size="icon" variant="ghost" aria-label={`Delete ${room.name}`} onClick={() => confirm(`Delete ${room.name} and its ${roomTables.length} tables?`) && deleteRoom.mutate(room.id)} data-testid="button-delete-room"><Trash2 className="h-4 w-4" /></Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div ref={box} style={{ aspectRatio: aspect }}
          className={cn("relative w-full touch-none select-none overflow-hidden rounded-lg border bg-card", !hasImg && "bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px)]")}
          onPointerDown={(e) => { if (e.target === box.current || (e.target as HTMLElement).dataset.bg) setSel(null); }} data-testid="canvas-floor">
          {hasImg && <img src={room!.imageData} alt={`${room!.name} floor plan`} data-bg="1" draggable={false} className="pointer-events-auto absolute inset-0 h-full w-full object-fill" style={{ opacity: opacity / 100 }} />}
          {!hasImg && roomTables.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <ImagePlus className="h-8 w-8" />
              <p>Upload a screenshot, photo or PDF of {room?.name || "this room"}.<br />OpenTable, Resy and Tock floor-plan screenshots work well.</p>
            </div>
          )}
          {roomTables.map((x) => {
            const pos = drag?.id === x.id ? drag : x;
            const w = x.w || autoSize(x);
            const style: React.CSSProperties = { left: `${pos.x}%`, top: `${pos.y}%`, width: `${w}%` };
            if (x.h) style.height = `${x.h}%`; else style.aspectRatio = x.shape === "rect" ? "2 / 1" : "1 / 1";
            return (
              <button key={x.id} type="button"
                onPointerDown={(e) => { e.preventDefault(); moved.current = false; setSel(x.id); dragRef.current = { id: x.id, x: x.x, y: x.y }; setDrag(dragRef.current); }}
                className={cn("absolute flex flex-col items-center justify-center border-2 text-[11px] font-semibold leading-tight shadow-sm transition-shadow",
                  AREA_STYLE[x.area] || AREA_STYLE.inside, x.shape === "round" ? "rounded-full" : "rounded-md",
                  sel === x.id && "ring-2 ring-primary ring-offset-2", !x.active && "opacity-40", drag?.id === x.id ? "cursor-grabbing shadow-lg" : "cursor-grab")}
                style={style} data-testid={`table-${x.id}`}>
                <span>{x.label}</span><span className="font-normal text-muted-foreground">{x.capacity}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {found && (
            <Section title={`Found ${found.length} tables`} right={<Button variant="ghost" size="icon" aria-label="Dismiss" onClick={() => setFound(null)}><X className="h-4 w-4" /></Button>}>
              <p className="mb-2 text-xs text-muted-foreground">Check the seat counts. You can edit anything after adding.</p>
              <ul className="mb-3 max-h-56 space-y-1 overflow-auto text-sm">
                {found.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-14 font-medium">{d.label}</span>
                    <Input type="number" min={1} value={d.capacity} className="h-7 w-16" aria-label={`Seats at ${d.label}`}
                      onChange={(e) => setFound(found.map((y, j) => (j === i ? { ...y, capacity: Number(e.target.value) || 1 } : y)))} />
                    <span className="text-xs text-muted-foreground">{AREA_LABEL[d.area] || d.area} · {d.shape}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => addFound.mutate(true)} disabled={addFound.isPending || !found.length} data-testid="button-replace-tables">Replace room tables</Button>
                <Button size="sm" variant="outline" onClick={() => addFound.mutate(false)} disabled={addFound.isPending || !found.length} data-testid="button-append-tables">Add to room</Button>
              </div>
            </Section>
          )}
          {t ? (
            <Section title={`Edit ${t.label}`} right={<Button variant="ghost" size="icon" aria-label="Delete table" onClick={() => confirm(`Delete ${t.label}?`) && del.mutate(t.id)} data-testid="button-delete-table"><Trash2 className="h-4 w-4" /></Button>}>
              <div key={t.id} className="grid grid-cols-2 gap-3">
                <div><Label>Label</Label><Input defaultValue={t.label} onBlur={(e) => e.target.value !== t.label && patch.mutate({ id: t.id, data: { label: e.target.value } })} data-testid="input-table-label" /></div>
                <div><Label>Seats</Label><Input type="number" min={1} defaultValue={t.capacity} onBlur={(e) => Number(e.target.value) !== t.capacity && patch.mutate({ id: t.id, data: { capacity: Number(e.target.value) } })} data-testid="input-table-capacity" /></div>
                <div><Label>Area</Label>
                  <Select value={t.area} onValueChange={(v) => patch.mutate({ id: t.id, data: { area: v } })}>
                    <SelectTrigger data-testid="select-table-area"><SelectValue /></SelectTrigger>
                    <SelectContent>{AREAS.map((a) => <SelectItem key={a} value={a}>{AREA_LABEL[a]}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Shape</Label>
                  <Select value={t.shape} onValueChange={(v) => patch.mutate({ id: t.id, data: { shape: v } })}>
                    <SelectTrigger data-testid="select-table-shape"><SelectValue /></SelectTrigger>
                    <SelectContent>{["square", "round", "rect"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Merge group</Label><Input list="merge-groups" defaultValue={t.mergeGroup} placeholder="none" onBlur={(e) => e.target.value !== t.mergeGroup && patch.mutate({ id: t.id, data: { mergeGroup: e.target.value.trim() } })} data-testid="input-merge-group" />
                  <datalist id="merge-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></div>
                <div><Label>Order in row</Label><Input type="number" defaultValue={t.mergeOrder} onBlur={(e) => Number(e.target.value) !== t.mergeOrder && patch.mutate({ id: t.id, data: { mergeOrder: Number(e.target.value) } })} data-testid="input-merge-order" /></div>
                {rooms.length > 1 && (
                  <div className="col-span-2"><Label>Room</Label>
                    <Select value={String(t.roomId || rooms[0].id)} onValueChange={(v) => { patch.mutate({ id: t.id, data: { roomId: Number(v) } }); setSel(null); }}>
                      <SelectTrigger data-testid="select-table-room"><SelectValue /></SelectTrigger>
                      <SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}</SelectContent>
                    </Select></div>
                )}
                <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={t.active} onCheckedChange={(v) => patch.mutate({ id: t.id, data: { active: v } })} data-testid="switch-table-active" />In service tonight</label>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Tables in the same merge group can be pushed together. Only neighbours in row order merge. Bar and ballroom tables aren't used for regular reservations.</p>
            </Section>
          ) : (
            <Section title={room?.name || "Tables"}><p className="text-sm text-muted-foreground">Select a table to edit it, or drag to move it. Positions save on drop.</p></Section>
          )}
          <Section title="Merge groups">
            {groups.length === 0 ? <p className="text-sm text-muted-foreground">None in this room.</p> : (
              <ul className="space-y-2 text-sm">
                {groups.map((g) => {
                  const g2 = roomTables.filter((x) => x.mergeGroup === g).sort((a, b) => a.mergeOrder - b.mergeOrder);
                  return <li key={g} className="flex flex-wrap items-center gap-1.5"><span className="w-20 shrink-0 text-xs text-muted-foreground">{g}</span>{g2.map((x) => <Pill key={x.id}>{x.label}</Pill>)}<span className="text-xs text-muted-foreground">= {g2.reduce((s, x) => s + x.capacity, 0)}</span></li>;
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
