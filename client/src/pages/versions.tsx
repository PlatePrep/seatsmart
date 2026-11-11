import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { errMsg, getJson, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { History, RotateCcw, Save } from "lucide-react";

type Version = { id: number; createdAt: string; label: string; kind: string; summary: string };
type Diff = Record<string, { added: number; removed: number; changed: number }>;
const AREA: Record<string, string> = {
  reservations: "Reservations", dining_tables: "Tables", rooms: "Rooms", rules: "Rules", pacing_overrides: "Pacing by date",
  blocks: "Blocks", servers: "Servers", shifts: "Shifts",
};
const KIND: Record<string, { l: string; t: any }> = { manual: { l: "Saved", t: "teal" }, system: { l: "Key change", t: "amber" }, auto: { l: "Auto", t: "gray" } };

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function Versions() {
  const { locationId } = useApp();
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [pick, setPick] = useState<Version | null>(null);
  const { data: list = [], isLoading } = useQuery<Version[]>({ queryKey: ["/api/locations", locationId, "versions"], enabled: !!locationId });
  const { data: diff } = useQuery<Diff>({ queryKey: ["version-diff", pick?.id], queryFn: () => getJson(`/api/versions/${pick!.id}/diff`), enabled: !!pick });
  const save = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/versions`, { label }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/locations", locationId, "versions"] }); setLabel(""); toast({ title: "Version saved" }); },
    onError: (e) => toast({ title: "Couldn't save", description: errMsg(e), variant: "destructive" }),
  });
  const restore = useMutation({
    mutationFn: (v: Version) => send("POST", `/api/versions/${v.id}/restore`),
    onSuccess: (_r, v) => { queryClient.invalidateQueries(); setPick(null); toast({ title: "Restored", description: `Back to ${when(v.createdAt)}. Your state just before the restore was saved, so you can undo it from this list.` }); },
    onError: (e) => toast({ title: "Restore failed", description: errMsg(e), variant: "destructive" }),
  });
  const changes = diff ? Object.entries(diff).filter(([, d]) => d.added + d.removed + d.changed > 0) : [];

  return (
    <div>
      <PageHeader title="Version history" sub="SeatSmart saves a version before every change. Restore any one if something goes wrong." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version (e.g. Thanksgiving final)" className="w-80 max-w-full" maxLength={120} data-testid="input-version-label" />
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-version"><Save className="mr-1.5 h-4 w-4" />Save version now</Button>
      </div>
      {isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : list.length === 0 ? (
        <Empty title="No versions yet">The first one is saved automatically the next time anything changes.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Contents</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((v, i) => (
                <tr key={v.id} data-testid={`row-version-${v.id}`}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{when(v.createdAt)}</td>
                  <td className="px-3 py-2"><div className="flex items-center gap-2"><Pill t={KIND[v.kind]?.t || "gray"}>{KIND[v.kind]?.l || v.kind}</Pill><span>{v.label}</span>{i === 0 && <span className="text-xs text-muted-foreground">latest</span>}</div></td>
                  <td className="px-3 py-2 text-muted-foreground">{v.summary}</td>
                  <td className="px-3 py-2 text-right"><Button variant="outline" size="sm" onClick={() => setPick(v)} data-testid={`button-restore-${v.id}`}><RotateCcw className="mr-1 h-3.5 w-3.5" />Restore</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">Versions cover reservations, tables and rooms, rules, pacing by date, blocks, servers and shifts. Texts, calls, emails and card charges already sent can't be undone, and API keys aren't changed.</p>

      <Dialog open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />Restore this version?</DialogTitle>
            <DialogDescription>{pick && `${when(pick.createdAt)} · ${pick.label}`}</DialogDescription>
          </DialogHeader>
          {!diff ? <div className="h-20 animate-pulse rounded bg-muted" /> : changes.length === 0 ? (
            <p className="text-sm">This version matches what you have now. Nothing would change.</p>
          ) : (
            <div className="text-sm">
              <p className="mb-2">Compared with now, restoring will:</p>
              <ul className="space-y-1">
                {changes.map(([k, d]) => (
                  <li key={k} data-testid={`diff-${k}`}><span className="font-medium">{AREA[k] || k}:</span>{" "}
                    {[d.added && `bring back ${d.added}`, d.removed && `remove ${d.removed} added since`, d.changed && `undo edits to ${d.changed}`].filter(Boolean).join(", ")}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">Your current state is saved first, so you can undo the restore.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPick(null)}>Cancel</Button>
            <Button onClick={() => pick && restore.mutate(pick)} disabled={!diff || changes.length === 0 || restore.isPending} data-testid="button-confirm-restore">Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
