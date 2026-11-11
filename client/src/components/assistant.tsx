import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useApp } from "@/lib/app-context";
import { errMsg, send } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Check, Loader2, MessageSquareText, RotateCcw, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Action = { id: string; tool: string; args: any; summary: string };
type Result = { id: string; summary: string; ok: boolean; message: string };
type Entry =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string; actions?: Action[]; state?: "pending" | "applied" | "discarded"; results?: Result[]; versionId?: number | null; undone?: boolean }
  | { kind: "error"; text: string };

const PAGE: Record<string, string> = { tonight: "/", reservations: "/reservations", plan: "/plan", "floor-view": "/floor-view", staff: "/staff", pacing: "/pacing", "floor-plan": "/floor-plan", confirmations: "/confirmations", calls: "/calls", rules: "/rules", settings: "/settings", versions: "/versions" };
const EXAMPLES = [
  "Move Lauren Goodall to 5:00 PM",
  "Set the pace cap on Thanksgiving to 25",
  "Hold tables 22–28 for walk-ins tonight 5–7 PM",
  "Who's unseated on Thanksgiving and why?",
];

export function Assistant() {
  const { locationId, date, setDate } = useApp();
  const [path, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [skip, setSkip] = useState<Record<string, boolean>>({});
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  const history = (l: Entry[]) => l.filter((e) => e.kind !== "error").map((e) => ({
    role: e.kind === "user" ? "user" as const : "assistant" as const,
    content: e.kind === "bot" ? [e.text, ...(e.actions || []).map((a) => `- ${a.summary}${e.state === "applied" ? " (applied)" : e.state === "discarded" ? " (discarded)" : " (waiting for approval)"}`)].join("\n") : e.text,
  }));

  async function ask(q: string) {
    if (!q.trim() || !locationId || busy) return;
    const next: Entry[] = [...log, { kind: "user", text: q.trim() }];
    setLog(next); setText(""); setBusy(true);
    try {
      const page = path === "/" ? "tonight" : path.slice(1);
      const r: any = await send("POST", `/api/locations/${locationId}/assistant`, { messages: history(next), date, page });
      setLog((l) => [...l, { kind: "bot", text: r.reply, actions: r.actions?.length ? r.actions : undefined, state: r.actions?.length ? "pending" : undefined }]);
      if (r.navigate?.page && PAGE[r.navigate.page]) { if (r.navigate.date) setDate(r.navigate.date); navigate(PAGE[r.navigate.page]); }
    } catch (e) { setLog((l) => [...l, { kind: "error", text: errMsg(e) }]); }
    setBusy(false);
  }

  async function apply(i: number) {
    const e = log[i]; if (e.kind !== "bot" || !e.actions) return;
    const chosen = e.actions.filter((a) => !skip[a.id]);
    if (!chosen.length) return;
    const request = [...log.slice(0, i)].reverse().find((x) => x.kind === "user")?.text || "";
    setBusy(true);
    try {
      const r: any = await send("POST", `/api/locations/${locationId}/assistant/apply`, { actions: chosen, request });
      setLog((l) => l.map((x, k) => (k === i && x.kind === "bot" ? { ...x, state: "applied", results: r.results, versionId: r.versionId } : x)));
      queryClient.invalidateQueries();
    } catch (err) { setLog((l) => [...l, { kind: "error", text: errMsg(err) }]); }
    setBusy(false);
  }
  async function undo(i: number) {
    const e = log[i]; if (e.kind !== "bot" || !e.versionId) return;
    setBusy(true);
    try {
      await send("POST", `/api/versions/${e.versionId}/restore`);
      setLog((l) => l.map((x, k) => (k === i && x.kind === "bot" ? { ...x, undone: true } : x)));
      queryClient.invalidateQueries();
    } catch (err) { setLog((l) => [...l, { kind: "error", text: errMsg(err) }]); }
    setBusy(false);
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-40">
        <Button onClick={() => setOpen(true)} className="h-11 rounded-full px-4 shadow-lg" data-testid="button-open-assistant">
          <MessageSquareText className="mr-2 h-4 w-4" />Ask SeatSmart
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle>Ask SeatSmart</SheetTitle>
            <SheetDescription>Say what you want done. You'll review every change before it's applied, and you can undo it.</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="assistant-log">
            {log.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Try:</p>
                {EXAMPLES.map((x) => (
                  <button key={x} onClick={() => ask(x)} className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted" data-testid="button-assistant-example">{x}</button>
                ))}
              </div>
            )}
            {log.map((e, i) => e.kind === "user" ? (
              <div key={i} className="ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" data-testid="assistant-user">{e.text}</div>
            ) : e.kind === "error" ? (
              <div key={i} className="mr-8 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="assistant-error">{e.text}</div>
            ) : (
              <div key={i} className="mr-4 space-y-2" data-testid="assistant-bot">
                <div className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">{e.text}</div>
                {e.actions && (
                  <div className="rounded-lg border bg-card p-3" data-testid="assistant-actions">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{e.state === "pending" ? "Changes to apply" : e.state === "applied" ? (e.undone ? "Undone" : "Applied") : "Discarded"}</div>
                    <ul className="space-y-1.5">
                      {e.actions.map((a) => {
                        const res = e.results?.find((r) => r.id === a.id);
                        return (
                          <li key={a.id} className="flex items-start gap-2 text-sm">
                            {e.state === "pending" ? <Checkbox checked={!skip[a.id]} onCheckedChange={(v) => setSkip((s) => ({ ...s, [a.id]: !v }))} className="mt-0.5" data-testid={`check-action-${a.id}`} />
                              : res ? (res.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />) : <span className="w-4" />}
                            <span className={cn(e.state !== "pending" && !res && "text-muted-foreground line-through")}>{a.summary}{res && !res.ok && <span className="block text-xs text-destructive">{res.message}</span>}</span>
                          </li>
                        );
                      })}
                    </ul>
                    {e.state === "pending" && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => apply(i)} disabled={busy} data-testid="button-apply-actions">Apply</Button>
                        <Button size="sm" variant="outline" onClick={() => setLog((l) => l.map((x, k) => (k === i && x.kind === "bot" ? { ...x, state: "discarded" } : x)))} disabled={busy} data-testid="button-discard-actions">Discard</Button>
                      </div>
                    )}
                    {e.state === "applied" && e.versionId && !e.undone && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => undo(i)} disabled={busy} data-testid="button-undo-actions"><RotateCcw className="mr-1 h-3.5 w-3.5" />Undo</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Working…</div>}
            <div ref={end} />
          </div>
          <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. Move the Deans to 3:30 and put them in the ballroom"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }} className="min-h-[44px] resize-none" data-testid="input-assistant" />
            <Button type="submit" size="icon" disabled={!text.trim() || busy} aria-label="Send" data-testid="button-send-assistant"><Send className="h-4 w-4" /></Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
