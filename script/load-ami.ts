// One-off: load the Anna Maria rooms + tables into an existing database (first location).
import { storage } from "../server/storage";
import { applyAmiLayout } from "../server/ami-layout";
const loc = storage.listLocations()[0];
if (!loc) throw new Error("No locations");
storage.updateLocation(loc.id, { name: "Anna Maria", city: "Anna Maria", state: "FL" });
applyAmiLayout(loc.id);
console.log(`Loaded Anna Maria layout into location ${loc.id}:`, storage.listRooms(loc.id).map((r) => `${r.name} (${storage.listTables(loc.id).filter((t) => t.roomId === r.id).length})`).join(", "));
