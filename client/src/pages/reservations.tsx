import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Reservation } from "@shared/schema";
import { addDays, dateLabel, timeLabel } from "@shared/time";
import { useApp } from "@/lib/app-context";
import { errMsg, getJson, invalidateLocation, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill, STATUS_TONE, Empty } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Upload, Trash2 } from "lucide-react";

const STATUSES = ["booked", "confirmed", "seated", "completed", "cancelled", "no_show"];
const blank = { guestName: "", partySize: 2, time: "19:00", phone: "", email: "", visits: 0, notes: "", birthday: false, preference: "any" };

export default function Reservations() {
  const { locationId, date, setDate } = useApp();
  const { toast } = useToast();
  const { data: list = [], isLoading } = useQuery<Reservation[]>({
    queryKey: ["/api/locations", locationId, "reservations", "date", date],
    queryFn: () => getJson(`/api/locations/${locationId}/reservations?date=${date}`), enabled: !!locationId,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(blank);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const done = () => invalidateLocation(locationId);
  const add = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/reservations`, { ...form, date }),
    onSuccess: () => { done(); setOpen(false); setForm(blank); toast({ title: "Reservation added" }); },
    onError: (e) => toast({ title: "Couldn't add", description: errMsg(e), variant: "destructive" }),
  });
  const patch = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => send("PATCH", `/api/reservations/${id}`, data),
    onSuccess: done,
    onError: (e) => toast({ title: "Update failed", description: errMsg(e), variant: "destructive" }),
  });
  const del = useMutation({ mutationFn: (id: number) => send("DELETE", `/api/reservations/${id}`), onSuccess: done });
  const imp = useMutation({
    mutationFn: () => send("POST", `/api/locations/${locationId}/reservations/import`, { csv, date }),
    onSuccess: (r: any) => { done(); setCsvOpen(false); setCsv(""); toast({ title: `Imported ${r.added} reservations`, description: r.errors.length ? `${r.errors.length} rows skipped` : undefined }); },
    onError: (e) => toast({ title: "Import failed", description: errMsg(e), variant: "destructive" }),
  });

  const active = list.filter((r) => !["cancelled", "no_show"].includes(r.status));
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div>
      <PageHeader title="Reservations" sub={`${active.length} parties · ${active.reduce((s, r) => s + r.partySize, 0)} covers`}
        actions={<>
          <Button variant="outline" onClick={() => setCsvOpen(true)} data-testid="button-import-csv"><Upload className="mr-1.5 h-4 w-4" />Import OpenTable CSV</Button>
          <Button onClick={() => setOpen(true)} data-testid="button-add-reservation"><Plus className="mr-1.5 h-4 w-4" />Add reservation</Button>
        </>} />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" data-testid="button-prev-day"><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-testid="input-date" />
        <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Next day" data-testid="button-next-day"><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm text-muted-foreground">{dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}</span>
      </div>

      {isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : list.length === 0 ? (
        <Empty title="No reservations for this day">Add one, or import an OpenTable CSV export.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Guest</th><th className="px-3 py-2 text-right">Party</th><th className="px-3 py-2 text-right">Visits</th><th className="px-3 py-2">Booked</th><th className="px-3 py-2">Notes</th><th className="px-3 py-2">Status</th><th /></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((r) => (
                <tr key={r.id} className={r.status === "cancelled" ? "opacity-50" : ""} data-testid={`row-reservation-${r.id}`}>
                  <td className="px-3 py-2 font-mono tabular-nums">{timeLabel(r.time)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.guestName}</div>
                    <div className="text-xs text-muted-foreground">{r.phone}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.partySize}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.visits}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.bookedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.birthday && <Pill t="amber">Birthday</Pill>}
                      {r.preference !== "any" && <Pill>{r.preference}</Pill>}
                      {r.requiresCard && <Pill t={r.cardStatus === "on_file" ? "green" : "amber"}>{r.cardStatus === "on_file" ? "Card on file" : "Card needed"}</Pill>}
                    </div>
                    {r.notes && <div className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">{r.notes}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Select value={r.status} onValueChange={(v) => patch.mutate({ id: r.id, data: { status: v } })}>
                      <SelectTrigger className="h-8 w-32" data-testid={`select-status-${r.id}`}><Pill t={STATUS_TONE[r.status]}>{r.status.replace("_", "-")}</Pill></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", "-")}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => confirm(`Delete ${r.guestName}?`) && del.mutate(r.id)} data-testid={`button-delete-${r.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New reservation · {dateLabel(date)}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Guest name</Label><Input value={form.guestName} onChange={(e) => set("guestName", e.target.value)} data-testid="input-guest-name" /></div>
            <div><Label>Party size</Label><Input type="number" min={1} value={form.partySize} onChange={(e) => set("partySize", Number(e.target.value))} data-testid="input-party-size" /></div>
            <div><Label>Time</Label><Input type="time" value={form.time} onChange={(e) => set("time", e.target.value)} data-testid="input-time" /></div>
            <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-phone" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} data-testid="input-email" /></div>
            <div><Label>Past visits</Label><Input type="number" min={0} value={form.visits} onChange={(e) => set("visits", Number(e.target.value))} data-testid="input-visits" /></div>
            <div><Label>Seating</Label>
              <Select value={form.preference} onValueChange={(v) => set("preference", v)}>
                <SelectTrigger data-testid="select-preference"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="any">Any</SelectItem><SelectItem value="inside">Inside</SelectItem><SelectItem value="patio">Patio</SelectItem></SelectContent>
              </Select></div>
            <div className="col-span-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} data-testid="input-notes" /></div>
            <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={form.birthday} onCheckedChange={(v) => set("birthday", v)} data-testid="switch-birthday" />Birthday</label>
          </div>
          {form.partySize >= 10 && <p className="text-xs text-muted-foreground">Party of {form.partySize}: card-on-file reminders start automatically.</p>}
          <DialogFooter><Button onClick={() => add.mutate()} disabled={!form.guestName || add.isPending} data-testid="button-save-reservation">Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Import OpenTable CSV</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Needs columns for Time, Guest name and Party size. Date, Phone, Email, Visits and Notes are used when present. Rows without a date go on {dateLabel(date)}.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} data-testid="input-csv-file" />
          <Button variant="outline" onClick={() => fileRef.current?.click()} data-testid="button-choose-csv">Choose file</Button>
          <Textarea rows={8} className="font-mono text-xs" placeholder={"Date,Time,Guest,Party Size,Phone,Visits,Notes\n2026-11-09,19:00,Jane Doe,4,941-555-0100,3,Birthday"} value={csv} onChange={(e) => setCsv(e.target.value)} data-testid="input-csv-text" />
          <DialogFooter><Button onClick={() => imp.mutate()} disabled={!csv.trim() || imp.isPending} data-testid="button-run-import">Import</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
