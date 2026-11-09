// Turns an uploaded screenshot, photo or PDF into a compact data URL for a room background.
const MAX_SIDE = 1800;

function canvasToResult(c: HTMLCanvasElement) {
  return { dataUrl: c.toDataURL("image/jpeg", 0.86), width: c.width, height: c.height };
}

async function fromImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("That image couldn't be opened. Try a PNG or JPEG."));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return canvasToResult(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fromPdf(file: File) {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
  const c = document.createElement("canvas");
  c.width = Math.round(viewport.width);
  c.height = Math.round(viewport.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport } as any).promise;
  return canvasToResult(c);
}

export async function readFloorPlanFile(file: File) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf && !file.type.startsWith("image/")) throw new Error("Upload a screenshot, photo (PNG/JPEG) or PDF.");
  if (file.size > 30 * 1024 * 1024) throw new Error("That file is over 30 MB.");
  return isPdf ? fromPdf(file) : fromImage(file);
}
