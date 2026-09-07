import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Small deterministic source fixture; never render the user-supplied oversized banner here.
export function thumbnailGoldenPdf() {
  const content = Array.from(
    { length: 18 },
    (_, index) =>
      `BT /F1 ${6 + (index % 3)} Tf 12 ${275 - index * 14} Td (Table row ${index}: 0123456789 ABC xyz) Tj ET\n0.5 w 10 ${272 - index * 14} m 205 ${272 - index * 14} l S`,
  ).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 216 288] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export async function runPdfThumbnailBenchmark() {
  const sharp = createRequire(new URL("../apps/api/package.json", import.meta.url))("sharp");
  const { createPopplerPdfRasterizer } = await import(
    "../packages/api/src/document-pdf-rasterizer.ts"
  );
  const request = { documentBody: thumbnailGoldenPdf(), elementId: "golden-page", pageNumber: 1 };
  const baseline = createPopplerPdfRasterizer({ dpi: 144, thumbnailDpi: 48 });
  // Equal DPI uses the same rasterized page; derive the preview from its full-resolution crop.
  const onePass = createPopplerPdfRasterizer({ dpi: 144, thumbnailDpi: 144 });
  const samples = [];
  for (let iteration = 0; iteration < 5; iteration++) {
    let started = performance.now();
    const original = await baseline.render(request);
    const twoRenderMs = performance.now() - started;
    const expected = original?.variants?.thumbnail?.body;
    if (!expected) throw new Error("Baseline thumbnail is missing");
    const geometry = await sharp(expected).metadata();
    started = performance.now();
    const candidate = await onePass.render(request);
    if (!candidate) throw new Error("Candidate image is missing");
    const resized = await sharp(candidate.body, { limitInputPixels: 1_000_000 })
      .resize(geometry.width, geometry.height)
      .png()
      .toBuffer();
    const oneRenderAndResizeMs = performance.now() - started;
    const a = await sharp(expected).removeAlpha().raw().toBuffer();
    const b = await sharp(resized).removeAlpha().raw().toBuffer();
    if (a.length !== b.length) throw new Error("Thumbnail geometry mismatch");
    let squaredError = 0;
    for (let index = 0; index < a.length; index++) squaredError += (a[index] - b[index]) ** 2;
    const mse = squaredError / a.length;
    samples.push({
      twoRenderMs,
      oneRenderAndResizeMs,
      equalPixels: mse === 0,
      psnrDb: mse === 0 ? null : 10 * Math.log10(255 ** 2 / mse),
      originalBytes: expected.byteLength,
      derivedBytes: resized.byteLength,
    });
  }
  return {
    benchmark: "pdf-thumbnail-single-raster-evaluation-v1",
    fixture: "216x288pt ASCII small text/table grid",
    maxRasterPixels: 248832,
    samples,
    decision:
      "Keep production two-render default: resampling is not pixel-equivalent; OCR/non-Latin/diagram quality and process-tree RSS need the wider provider golden corpus.",
    excludes: ["OCR accuracy", "non-Latin text", "process-tree peak RSS", "production throughput"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await runPdfThumbnailBenchmark(), null, 2));
