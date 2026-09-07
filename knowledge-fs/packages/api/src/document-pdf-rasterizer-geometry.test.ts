import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createPopplerPdfRasterizer } from "./document-pdf-rasterizer";

function geometryPdf({
  cropBox,
  mediaBox,
  rotation = 0,
}: {
  readonly cropBox: readonly [number, number, number, number];
  readonly mediaBox: readonly [number, number, number, number];
  readonly rotation?: number;
}): Uint8Array {
  const [x, y, right, top] = mediaBox;
  const halfWidth = (right - x) / 2;
  const halfHeight = (top - y) / 2;
  const content = [
    `1 0 0 rg ${x} ${y + halfHeight} ${halfWidth} ${halfHeight} re f`,
    `0 1 0 rg ${x + halfWidth} ${y + halfHeight} ${halfWidth} ${halfHeight} re f`,
    `0 0 1 rg ${x} ${y} ${halfWidth} ${halfHeight} re f`,
    `1 1 0 rg ${x + halfWidth} ${y} ${halfWidth} ${halfHeight} re f`,
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}] /CropBox [${cropBox.join(" ")}] /Rotate ${rotation} /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe("real Poppler MediaBox geometry admission", () => {
  it("caps the rendered MediaBox before allocation even when the CropBox is smaller", async () => {
    const rasterizer = createPopplerPdfRasterizer({
      dpi: 72,
      maxPageDimension: 1_000,
      maxPagePixels: 10_000,
      thumbnailDpi: 72,
    });

    const image = await rasterizer.render({
      documentBody: geometryPdf({ cropBox: [36, 36, 108, 108], mediaBox: [0, 0, 144, 144] }),
      elementId: "small-crop-box",
      pageNumber: 1,
    });

    expect(image).not.toBeNull();
    await expect(sharp(image?.body).metadata()).resolves.toMatchObject({ height: 100, width: 100 });
  });

  it("accounts for rounded pdfinfo box coordinates before a boundary-sized allocation", async () => {
    const rasterizer = createPopplerPdfRasterizer({
      dpi: 72,
      maxPageDimension: 1_000,
      maxPagePixels: 10_000,
      thumbnailDpi: 72,
    });

    const image = await rasterizer.render({
      documentBody: geometryPdf({
        cropBox: [0, 0, 100.004, 100],
        mediaBox: [0, 0, 100.004, 100],
      }),
      elementId: "rounded-media-box",
      pageNumber: 1,
    });

    await expect(sharp(image?.body).metadata()).resolves.toMatchObject({ height: 100, width: 100 });
  });

  it("bounds the shorter scaled edge when rounding conceals a larger aspect ratio", async () => {
    const rasterizer = createPopplerPdfRasterizer({
      dpi: 72,
      maxPageDimension: 1_000,
      maxPagePixels: 20_000,
      thumbnailDpi: 72,
    });

    const image = await rasterizer.render({
      documentBody: geometryPdf({
        cropBox: [0, 0, 100.004, 199.996],
        mediaBox: [0, 0, 100.004, 199.996],
      }),
      elementId: "rounded-aspect-ratio",
      pageNumber: 1,
    });

    await expect(sharp(image?.body).metadata()).resolves.toMatchObject({ height: 199, width: 100 });
  });

  it("keeps the original rendering of an ordinary uncapped page", async () => {
    const image = await createPopplerPdfRasterizer({ dpi: 72, thumbnailDpi: 72 }).render({
      documentBody: geometryPdf({ cropBox: [0, 0, 144, 72], mediaBox: [0, 0, 144, 72] }),
      elementId: "ordinary-page",
      pageNumber: 1,
    });

    await expect(sharp(image?.body).metadata()).resolves.toMatchObject({ height: 72, width: 144 });
  });

  it.each([
    { color: [255, 0, 0], rotation: 0 },
    { color: [0, 0, 255], rotation: 90 },
    { color: [255, 255, 0], rotation: 180 },
    { color: [0, 255, 0], rotation: 270 },
  ])(
    "preserves displayed crop coordinates with nonzero origin and rotation=$rotation",
    async ({ color, rotation }) => {
      const rasterizer = createPopplerPdfRasterizer({
        dpi: 72,
        maxPageDimension: 100,
        maxPagePixels: 20_000,
        thumbnailDpi: 72,
      });
      const rotated = rotation === 90 || rotation === 270;
      const pageWidth = rotated ? 72 : 144;
      const pageHeight = rotated ? 144 : 72;

      const images = await rasterizer.renderBatch?.({
        documentBody: geometryPdf({
          cropBox: [72, 90, 144, 126],
          mediaBox: [36, 72, 180, 144],
          rotation,
        }),
        requests: [
          { elementId: "page", pageNumber: 1 },
          {
            boundingBox: { height: 0.2, width: 0.2, x: 0.1, y: 0.1 },
            boundingBoxGeometry: { coordinateSystem: "relative" },
            elementId: "relative-crop",
            pageNumber: 1,
          },
          {
            boundingBox: {
              height: pageHeight * 0.2,
              width: pageWidth * 0.2,
              x: pageWidth * 0.1,
              y: pageHeight * 0.1,
            },
            boundingBoxGeometry: { coordinateSystem: "pixel", pageHeight, pageWidth },
            elementId: "pixel-crop",
            pageNumber: 1,
          },
          {
            boundingBox: {
              height: pageHeight * 0.2,
              width: pageWidth * 0.2,
              x: pageWidth * 0.1,
              y: pageHeight * 0.1,
            },
            boundingBoxGeometry: { coordinateSystem: "pdf-point", pageHeight, pageWidth },
            elementId: "displayed-point-crop",
            pageNumber: 1,
          },
        ],
      });

      await expect(sharp(images?.[0]?.body).metadata()).resolves.toMatchObject({
        height: rotated ? 100 : 50,
        width: rotated ? 50 : 100,
      });
      for (const image of images?.slice(1) ?? []) {
        const { data, info } = await sharp(image?.body)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(info).toMatchObject({ height: rotated ? 20 : 10, width: rotated ? 10 : 20 });
        expect([...data.subarray(0, 3)]).toEqual(color);
        expect([...data.subarray(data.length - 3)]).toEqual(color);
      }
    },
  );
});
