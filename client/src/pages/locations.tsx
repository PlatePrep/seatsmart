import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApp } from "@/lib/app-context";
import { errMsg, invalidateLocation, send } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, Pill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Locations() {
  const { locations, locationId, setLocationId } = useApp();
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", city: "", state: "", phone: "" });
  const add = useMutation({
    mutationFn: () => send("POST", "/api/locations", f),
    onSuccess: (l: any) => { invalidateLocation(null); setF({ name: "", city: "", state: "", phone: "" }); setLocationId(l.id); toast({ title: "Location added" }); },
    onError: (e) => toast({ title: "Couldn't add", description: errMsg(e), variant: "destructive" }),
  });
  return (
    <div>
      <PageHeader title="Locations" />
      <div className="grid gap-3 md:grid-cols-2">
        {locations.map((l) => (
          <button key={l.id} type="button" onClick={() => setLocationId(l.id)} data-testid={`card-location-${l.id}`}
            className={`rounded-lg border bg-card p-4 text-left hover:border-primary/40 ${l.id === locationId ? "border-primary ring-1 ring-primary" : ""}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-medium">{l.name}</span>{l.id === locationId && <Pill t="teal">Selected</Pill>}</div>
            <div className="text-sm text-muted-foreground">{[l.city, l.state].filter(Boolean).join(", ")} {l.phone && `· ${l.phone}`}</div>
            <div className="mt-2 text-sm">{l.tableCount} tables · {l.todayCount} reservations today</div>
          </button>
        ))}
      </div>
      <section className="mt-6 max-w-xl rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a location</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="input-location-name" /></div>
          <div><Label>City</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} data-testid="input-location-city" /></div>
          <div><Label>State</Label><Input value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} data-testid="input-location-state" /></div>
          <div className="col-span-2"><Label>Phone</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="input-location-phone" /></div>
        </div>
        <Button className="mt-4" onClick={() => add.mutate()} disabled={!f.name || add.isPending} data-testid="button-add-location">Add location</Button>
      </section>
    </div>
  );
}
