import { storage } from "./storage";
import { applyAmiLayout } from "./ami-layout";
import { syncCampaign, markCardOnFile } from "./outreach";
import { localToday, addDays } from "@shared/time";

export async function seedIfEmpty() {
  if (storage.listLocations().length) return;
  const loc = storage.createLocation({ name: "Anna Maria", city: "Anna Maria", state: "FL", phone: "(941) 555-0142" });
  storage.updateSettings(loc.id, { restaurantName: "The Chateau" });
  storage.createLocation({ name: "Bolton Landing", city: "Bolton Landing", state: "NY", phone: "" });

  applyAmiLayout(loc.id);


  const today = localToday();
  const booked = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  const tonight: [string, string, number, number, number, Partial<{ birthday: boolean; notes: string; preference: "patio" | "inside" | "any" }>][] = [
    ["16:15", "Amanda Ritchey", 2, 3, 9, {}],
    ["17:00", "Erin Walter", 4, 1, 6, {}],
    ["18:00", "Adison McGrath", 7, 0, 14, {}],
    ["18:00", "Frank Fitzgerald", 2, 4, 2, {}],
    ["18:00", "Wilton Soto", 2, 1, 11, { notes: "Anniversary" }],
    ["18:00", "April Stone", 2, 0, 5, {}],
    ["18:15", "Matt Clark", 8, 2, 4, {}],
    ["18:30", "Amber Dixon", 6, 1, 7, { birthday: true, notes: "Cake ~7:45" }],
    ["18:30", "Michael Thiel", 2, 0, 3, {}],
    ["18:45", "Kerry Mcgrath", 7, 3, 8, {}],
    ["19:00", "Casie Arnone", 5, 0, 1, {}],
    ["19:00", "Matthew Harrell", 5, 0, 10, { preference: "patio" }],
    ["19:15", "Sam Major", 6, 1, 2, {}],
    ["19:30", "Tommy Cannon", 6, 2, 3, {}],
    ["19:30", "Oscar Segovia", 4, 0, 1, {}],
    ["19:45", "Carter Shellhouse", 2, 0, 1, {}],
    ["20:00", "Sophia Dyke", 5, 1, 1, {}],
  ];
  tonight.forEach(([time, guestName, partySize, visits, daysAgo, extra], i) => {
    storage.createReservation({
      locationId: loc.id, date: today, time, guestName, partySize, visits, bookedAt: booked(daysAgo),
      phone: `+1941555${String(1000 + i).slice(-4)}`, email: `${guestName.split(" ")[0].toLowerCase()}@example.com`,
      notes: extra.notes || "", birthday: !!extra.birthday, preference: extra.preference || "any",
      status: "booked", requiresCard: false, cardStatus: "not_required", paymentMethodId: "", cardBrand: "", cardLast4: "",
      outreachToken: "", optedOut: false, noShowCharged: 0,
    });
  });

  // Big parties (10+) for the confirmation + card capture flow
  const big: [number, string, string, number, string][] = [
    [0, "21:00", "Gates Garcia", 14, "Patio requested, rehearsal group"],
    [1, "19:00", "Harper Rehearsal Dinner", 12, ""],
    [3, "19:30", "Morales Family", 11, "Grandparents' 50th"],
    [5, "18:30", "Bradenton Rotary", 16, "Ballroom overflow if needed"],
    [2, "20:00", "Delaney Birthday", 10, "Birthday — cake"],
  ];
  const created: number[] = [];
  big.forEach(([days, time, guestName, partySize, notes], i) => {
    const r = storage.createReservation({
      locationId: loc.id, date: addDays(today, days), time, guestName, partySize, visits: i % 2, bookedAt: booked(10 + i),
      phone: `+1941555${String(2000 + i)}`, email: `${guestName.split(" ")[0].toLowerCase()}@example.com`,
      notes, birthday: notes.includes("Birthday"), preference: "any", status: "booked", requiresCard: false, cardStatus: "not_required",
      paymentMethodId: "", cardBrand: "", cardLast4: "", outreachToken: "", optedOut: false, noShowCharged: 0,
    });
    created.push(r.id);
  });
  for (const r of storage.listReservations(loc.id)) syncCampaign(r.id);
  // One party already has a card on file
  await markCardOnFile(created[3], { brand: "visa", last4: "4242", paymentMethodId: "pm_mock_seed" });
}
