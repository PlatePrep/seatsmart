import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, CalendarDays, Armchair, Map, ShieldCheck, PhoneCall, SlidersHorizontal, Settings, Building2 } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NAV = [
  { href: "/", label: "Tonight", icon: LayoutDashboard },
  { href: "/reservations", label: "Reservations", icon: CalendarDays },
  { href: "/plan", label: "Seating plan", icon: Armchair },
  { href: "/floor-plan", label: "Floor plan", icon: Map },
  { href: "/confirmations", label: "Big parties", icon: ShieldCheck, badge: true },
  { href: "/calls", label: "AI calls", icon: PhoneCall },
  { href: "/rules", label: "Rules", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/locations", label: "Locations", icon: Building2 },
];

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-label="SeatSmart" role="img">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
      <circle cx="8" cy="9" r="2.2" fill="hsl(var(--background))" />
      <circle cx="16" cy="9" r="2.2" fill="hsl(var(--background))" />
      <rect x="5.5" y="13.5" width="13" height="4" rx="2" fill="hsl(var(--background))" />
    </svg>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { locations, locationId, setLocationId } = useApp();
  const { data: big = [] } = useQuery<any[]>({
    queryKey: ["/api/locations", locationId, "confirmations"], enabled: !!locationId, refetchInterval: 30000,
  });
  const needs = big.filter((b) => ["no_card", "at_risk"].includes(b.risk)).length;

  const switcher = (
    <Select value={locationId ? String(locationId) : undefined} onValueChange={(v) => setLocationId(Number(v))}>
      <SelectTrigger className="h-9 bg-background" data-testid="select-location"><SelectValue placeholder="Location" /></SelectTrigger>
      <SelectContent>
        {locations.map((l) => <SelectItem key={l.id} value={String(l.id)} data-testid={`option-location-${l.id}`}>{l.name}{l.state ? `, ${l.state}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const item = (n: (typeof NAV)[number], compact = false) => {
    const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
    const Icon = n.icon;
    return (
      <Link key={n.href} href={n.href} data-testid={`link-nav-${n.label.toLowerCase().replace(/\s/g, "-")}`}
        className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
          compact && "shrink-0 px-3",
          active ? "bg-foreground text-background" : "text-foreground/80 hover:bg-sidebar-accent")}>
        <Icon className="h-4 w-4 shrink-0" />
        <span>{n.label}</span>
        {n.badge && needs > 0 && (
          <span className={cn("ml-auto rounded-full px-1.5 text-xs font-semibold tabular-nums", active ? "bg-background text-foreground" : "bg-warn text-white")} data-testid="badge-needs-card">{needs}</span>
        )}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden border-r bg-sidebar md:flex md:h-dvh md:flex-col md:sticky md:top-0">
        <div className="flex items-center gap-2 px-4 pb-3 pt-4 text-primary">
          <Mark /><span className="text-base font-semibold tracking-tight text-foreground">SeatSmart</span>
        </div>
        <div className="px-3 pb-3">{switcher}</div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">{NAV.map((n) => item(n))}</nav>
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">Demo mode keeps texts, calls and charges simulated.</div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur md:hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 text-primary">
            <Mark /><span className="font-semibold text-foreground">SeatSmart</span>
            <div className="ml-auto w-40">{switcher}</div>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2">{NAV.map((n) => item(n, true))}</nav>
        </header>
        <main className="mx-auto max-w-[1240px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
