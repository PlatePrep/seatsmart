import { apiRequest, queryClient } from "@/lib/queryClient";

export async function getJson<T = any>(url: string): Promise<T> {
  return (await apiRequest("GET", url)).json();
}
export async function send<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  return (await apiRequest(method, url, body)).json();
}
/** "400: {"message":"..."}" -> "..." */
export function errMsg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  const m = s.match(/^\d{3}: ([\s\S]*)$/);
  if (m) {
    try { return JSON.parse(m[1]).message || m[1]; } catch { return m[1]; }
  }
  return s;
}
export function invalidateLocation(id: number | null) {
  queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["/api/locations", id] });
}
export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
