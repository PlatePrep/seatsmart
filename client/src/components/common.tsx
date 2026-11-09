import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const tone: Record<string, string> = {
  teal: "bg-primary/10 text-primary border-primary/20",
  green: "bg-ok/10 text-ok border-ok/25",
  amber: "bg-warn/12 text-[hsl(32_80%_30%)] border-warn/30",
  red: "bg-destructive/10 text-destructive border-destructive/25",
  gray: "bg-muted text-muted-foreground border-border",
  ink: "bg-foreground text-background border-foreground",
};

export function Pill({ children, t = "gray", className, testId }: { children: ReactNode; t?: keyof typeof tone; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", tone[t], className)}>
      {children}
    </span>
  );
}

export const RISK: Record<string, { label: string; t: keyof typeof tone }> = {
  on_file: { label: "Card on file", t: "green" },
  pending: { label: "Pending", t: "teal" },
  no_card: { label: "No card", t: "amber" },
  at_risk: { label: "At risk", t: "red" },
  opted_out: { label: "Opted out", t: "gray" },
  inactive: { label: "Inactive", t: "gray" },
};

export function RiskBadge({ risk, id }: { risk: string; id?: number | string }) {
  const r = RISK[risk] || RISK.inactive;
  return <Pill t={r.t} testId={`status-risk-${id ?? ""}`}>{r.label}</Pill>;
}

export const STATUS_TONE: Record<string, keyof typeof tone> = {
  booked: "gray", confirmed: "teal", seated: "ink", completed: "gray", cancelled: "red", no_show: "red",
};

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums" data-testid={testId}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const CHANNEL_LABEL: Record<string, string> = {
  sms_email: "SMS + Email", email: "Email", sms: "SMS", voice: "AI call", sms_final: "Final SMS", confirm: "Confirmation",
};
