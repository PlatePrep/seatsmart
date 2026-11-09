import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { DiningTable } from "@shared/schema";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Section, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";

const AREA_STYLE: Record<string, string> = {
  inside: "bg-card border-foreground/70",
  patio: "bg-patio border-[hsl(var(--patio-tint)/1)] border-foreground/40",
  bar: "bg-muted border-foreground/30",
  ballroom: "bg-gold border-foreground/40",
};

export default function FloorPlan() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const key = ["/api/locations", locationId, "tables"];
  const { data: tables = [] } = useQuery<DiningTable[]>({ queryKey: key, enabled: !!locationId });
  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const patch = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DiningTable> }) => send("PATCH", `/api/tables/${id}`, data),
    onMutate: ({ id, data }) => queryClient.setQueryData<DiningTable[]>(key, (old) => old?.map((t) => (t.id === id ? { ...t, ...data } : t))),
    onSettled: () => invalidateLocation(locationId),
    onError: (e) => toast({ title: "Save failed", description: errMsg(e), variant: "destructive" }),
  });
  const add = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/tables/add`, { label: `T${tables.length + 1}`, capacity: 4, area: "inside", shape: "square" }),
    onSuccess: (t: DiningTable) => { invalidateLocation(locationId); setSel(t.id); },
  });
  const del = useMutation({
    mutationFn: (id: number) => send("DELETE", `/api/tables/${id}`),
    onSuccess: () => { invalidateLocation(locationId); setSel(null); },
  });

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const r = box.current!.getBoundingClientRect();
      moved.current = true;
      const d = dragRef.current;
      if (!d) return;
      const next = { ...d, x: Math.max(0, Math.min(94, ((e.clientX - r.left) / r.width) * 100 - 3)), y: Math.max(0, Math.min(92, ((e.clientY - r.top) / r.height) * 100 - 4)) };
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

  const t = tables.find((x) => x.id === sel);
  const seats = tables.filter((x) => x.active && (x.area === "inside" || x.area === "patio"));
  const groups = Array.from(new Set(tables.map((x) => x.mergeGroup).filter(Boolean)));

  return (
    <div>
      <PageHeader title="Floor plan" sub={`${seats.length} tables · ${seats.filter((x) => x.area === "inside").reduce((s, x) => s + x.capacity, 0)} inside seats · ${seats.filter((x) => x.area === "patio").reduce((s, x) => s + x.capacity, 0)} patio seats. Drag to arrange.`}
        actions={<Button onClick={() => add.mutate()} data-testid="button-add-table"><Plus className="mr-1.5 h-4 w-4" />Add table</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div ref={box} className="relative aspect-[16/11] w-full touch-none select-none overflow-hidden rounded-lg border bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,hsl(var(--border)/.5)_24px)] bg-card"
          onPointerDown={(e) => { if (e.target === box.current) setSel(null); }} data-testid="canvas-floor">
          {tables.map((x) => {
            const pos = drag?.id === x.id ? drag : x;
            const w = x.shape === "rect" ? 11 : x.capacity >= 8 ? 9 : x.capacity >= 4 ? 7 : 6;
            return (
              <button key={x.id} type="button"
                onPointerDown={(e) => { e.preventDefault(); moved.current = false; setSel(x.id); dragRef.current = { id: x.id, x: x.x, y: x.y }; setDrag(dragRef.current); }}
                className={cn("absolute flex flex-col items-center justify-center border-2 text-[11px] font-semibold leading-tight shadow-sm transition-shadow",
                  AREA_STYLE[x.area] || AREA_STYLE.inside, x.shape === "round" ? "rounded-full" : "rounded-md",
                  sel === x.id && "ring-2 ring-primary ring-offset-2", !x.active && "opacity-40", drag?.id === x.id ? "cursor-grabbing shadow-lg" : "cursor-grab")}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, width: `${w}%`, aspectRatio: x.shape === "rect" ? "2 / 1" : "1 / 1" }}
                data-testid={`table-${x.id}`}>
                <span>{x.label}</span><span className="font-normal text-muted-foreground">{x.capacity}</span>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">
          {t ? (
            <Section title={`Edit ${t.label}`} right={<Button variant="ghost" size="icon" aria-label="Delete table" onClick={() => confirm(`Delete ${t.label}?`) && del.mutate(t.id)} data-testid="button-delete-table"><Trash2 className="h-4 w-4" /></Button>}>
              <div key={t.id} className="grid grid-cols-2 gap-3">
                <div><Label>Label</Label><Input defaultValue={t.label} onBlur={(e) => e.target.value !== t.label && patch.mutate({ id: t.id, data: { label: e.target.value } })} data-testid="input-table-label" /></div>
                <div><Label>Seats</Label><Input type="number" min={1} defaultValue={t.capacity} onBlur={(e) => Number(e.target.value) !== t.capacity && patch.mutate({ id: t.id, data: { capacity: Number(e.target.value) } })} data-testid="input-table-capacity" /></div>
                <div><Label>Area</Label>
                  <Select value={t.area} onValueChange={(v) => patch.mutate({ id: t.id, data: { area: v } })}>
                    <SelectTrigger data-testid="select-table-area"><SelectValue /></SelectTrigger>
                    <SelectContent>{["inside", "patio", "bar", "ballroom"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Shape</Label>
                  <Select value={t.shape} onValueChange={(v) => patch.mutate({ id: t.id, data: { shape: v } })}>
                    <SelectTrigger data-testid="select-table-shape"><SelectValue /></SelectTrigger>
                    <SelectContent>{["square", "round", "rect"].map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Merge group</Label><Input list="merge-groups" defaultValue={t.mergeGroup} placeholder="none" onBlur={(e) => e.target.value !== t.mergeGroup && patch.mutate({ id: t.id, data: { mergeGroup: e.target.value.trim() } })} data-testid="input-merge-group" />
                  <datalist id="merge-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></div>
                <div><Label>Order in row</Label><Input type="number" defaultValue={t.mergeOrder} onBlur={(e) => Number(e.target.value) !== t.mergeOrder && patch.mutate({ id: t.id, data: { mergeOrder: Number(e.target.value) } })} data-testid="input-merge-order" /></div>
                <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={t.active} onCheckedChange={(v) => patch.mutate({ id: t.id, data: { active: v } })} data-testid="switch-table-active" />In service tonight</label>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Tables in the same merge group can be pushed together. Only neighbours in row order merge.</p>
            </Section>
          ) : (
            <Section title="Tables"><p className="text-sm text-muted-foreground">Select a table to edit it, or drag to move it. Positions save on drop.</p></Section>
          )}
          <Section title="Merge groups">
            {groups.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
              <ul className="space-y-2 text-sm">
                {groups.map((g) => {
                  const g2 = tables.filter((x) => x.mergeGroup === g).sort((a, b) => a.mergeOrder - b.mergeOrder);
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
