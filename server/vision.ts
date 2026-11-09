// Reads tables off a floor-plan image (screenshot, photo or rendered PDF page) with an OpenAI vision model.
export type DetectedTable = {
  label: string; capacity: number; shape: "square" | "round" | "rect";
  area: "inside" | "patio" | "bar" | "ballroom"; x: number; y: number; w: number; h: number;
};

const PROMPT = (defaultArea: string) => `You are reading a restaurant floor plan image (an OpenTable/Resy/Tock screenshot, a photo, or a drawing).
List every table or seat you can see. For each one return:
- label: the table number or name exactly as printed (e.g. "12", "B4", "BAR1"). Ignore times like "1:30" printed on tables; those are reservation timers, not labels.
- capacity: number of seats. Count the chair marks around the table. If chairs aren't drawn, estimate from size (small square 2, larger square or round 4, long rectangle 6-8).
- shape: "round" for circles, "rect" for long rectangles, otherwise "square" (diamonds are squares).
- area: "bar" for bar seats/stools/bar counters (labels starting with B or BAR), otherwise "${defaultArea}".
- x, y: the top-left corner of the table as a percent (0-100) of the image width and height.
- w, h: the table's width and height as a percent of the image width and height.
Respond with JSON only: {"tables":[{"label":"1","capacity":2,"shape":"square","area":"${defaultArea}","x":10,"y":5,"w":4,"h":10}]}`;

export async function detectTables(imageDataUrl: string, apiKey: string, model: string, defaultArea: string): Promise<DetectedTable[]> {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT(defaultArea) },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
      ] }],
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI: ${j?.error?.message || r.status}`);
  let parsed: any;
  try { parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}"); } catch { throw new Error("The model didn't return readable JSON. Try again."); }
  const clamp = (n: any, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(n) || 0));
  const areas = ["inside", "patio", "bar", "ballroom"];
  return (Array.isArray(parsed.tables) ? parsed.tables : []).slice(0, 300).map((t: any) => ({
    label: String(t.label ?? "").slice(0, 20) || "?",
    capacity: Math.round(clamp(t.capacity, 1, 40)),
    shape: ["square", "round", "rect"].includes(t.shape) ? t.shape : "square",
    area: areas.includes(t.area) ? t.area : (defaultArea as any),
    x: clamp(t.x, 0, 98), y: clamp(t.y, 0, 98), w: clamp(t.w, 0, 100), h: clamp(t.h, 0, 100),
  }));
}
