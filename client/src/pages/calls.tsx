import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { PageHeader, Pill, Empty } from "@/components/common";

export default function Calls() {
  const { locationId } = useApp();
  const { data: list = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/locations", locationId, "calls"], enabled: !!locationId, refetchInterval: 20000 });
  return (
    <div>
      <PageHeader title="AI calls" sub="Synthflow calls: card reminders for big parties (T-4h) and offers to move patio guests inside. Start an offer from the patio rows on the seating plan." />
      {isLoading ? <div className="h-40 animate-pulse rounded-lg bg-muted" /> : list.length === 0 ? <Empty title="No calls yet" /> : (
        <ul className="space-y-3">
          {list.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card p-4" data-testid={`row-call-${c.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.guestName}</span>
                <Pill t={c.intent === "card_capture" ? "amber" : "teal"}>{c.intent === "card_capture" ? "Card reminder" : "Offer inside"}</Pill>
                <Pill t={c.status === "failed" ? "red" : c.status === "completed" ? "green" : "gray"}>{c.status}</Pill>
                {c.outcome && <span className="text-sm text-muted-foreground">{c.outcome.replace(/_/g, " ")}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              {c.transcript && <pre className="mt-3 whitespace-pre-wrap rounded-md bg-muted p-3 font-sans text-sm leading-relaxed">{c.transcript}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
