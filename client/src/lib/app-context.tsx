import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { localToday } from "@shared/time";
import { apiRequest } from "@/lib/queryClient";

export type LocationRow = Location & { tableCount: number; todayCount: number };

type Ctx = {
  locations: LocationRow[];
  loading: boolean;
  locationId: number | null;
  setLocationId: (id: number) => void;
  location: LocationRow | undefined;
  date: string;
  setDate: (d: string) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { data = [], isLoading } = useQuery<LocationRow[]>({ queryKey: ["/api/locations"] });
  const [locationId, setLocationId] = useState<number | null>(null);
  const [date, setDate] = useState(localToday());
  useEffect(() => {
    if (locationId == null && data.length) setLocationId(data[0].id);
  }, [data, locationId]);
  useEffect(() => {
    // lets the server build guest links that point back at this app
    const origin = window.location.href.split("#")[0];
    apiRequest("POST", "/api/client-origin", { origin }).catch(() => {});
  }, []);
  return (
    <AppCtx.Provider value={{ locations: data, loading: isLoading, locationId, setLocationId, location: data.find((l) => l.id === locationId), date, setDate }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppProvider not mounted");
  return c;
}
