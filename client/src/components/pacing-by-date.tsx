import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { dateLabel } from "@shared/time";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";

type Override = { id: number; date: string; pacingCovers: number; note: string };

/** Per-date pace caps. The Rules pace cap stays the default for every other day. */
export function PacingByDate({ locationId, defaultCovers, initialDate }: { locationId: number; defaultCovers: number; initialDate?: string }) {
  const { toast } = useToast();
  const { data: list = [] } = useQuery<Override[]>({ queryKey: ["/api/locations", locationId, "pacing-overrides"], enabled: !!locationId });
  const [date, setDate] = useState(initialDate || "");
  const [covers, setCovers] = useState<number | "">("");
  const [note, setNote] = useState("");
  const done = () => invalidateLocation(locationId);
  const save = useMutation({
    mutationFn: () => send("PUT", `/api/locations/${locationId}/pacing-overrides/${date}`, { pacingCovers: covers, note }),
    onSuccess: () => { done(); toast({ title: `Pacing set for ${dateLabel(date)}`, description: `${covers} covers per 15 minutes` }); setCovers(""); setNote(""); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const del = useMutation({
    mutationFn: (d: string) => send("DELETE", `/api/locations/${locationId}/pacing-overrides/${d}`),
    onSuccess: done,
  });
  return (
    <div data-testid="pacing-by-date">
      <div className="text-sm font-medium">Pacing by date</div>
      <p className="mt-0.5 text-xs text-muted-foreground">Set a different pace cap for a specific day. Every other day uses {defaultCovers} covers / 15 min.</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div><Label htmlFor="pace-date" className="text-xs">Date</Label><Input id="pace-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-40" data-testid="input-pace-date" /></div>
        <div><Label htmlFor="pace-date-covers" className="text-xs">Covers / 15 min</Label><Input id="pace-date-covers" type="number" min={1} value={covers} onChange={(e) => setCovers(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 w-24" data-testid="input-pace-date-covers" /></div>
        <div className="min-w-[8rem] flex-1"><Label htmlFor="pace-date-note" className="text-xs">Note</Label><Input id="pace-date-note" value={note} maxLength={80} placeholder="e.g. Thanksgiving, short staffed" onChange={(e) => setNote(e.target.value)} className="mt-1" data-testid="input-pace-date-note" /></div>
        <Button size="sm" onClick={() => save.mutate()} disabled={!date || !covers || save.isPending} data-testid="button-save-pace-date">Set</Button>
      </div>
      {list.length > 0 && (
        <ul className="mt-3 divide-y rounded-md border text-sm">
          {list.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-3 py-1.5" data-testid={`row-pace-${o.date}`}>
              <span className="w-40 shrink-0">{dateLabel(o.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
              <span className="font-medium tabular-nums">{o.pacingCovers} covers / 15 min</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.note}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del.mutate(o.date)} aria-label={`Remove pacing for ${o.date}`} data-testid={`button-del-pace-${o.date}`}><Trash2 className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
