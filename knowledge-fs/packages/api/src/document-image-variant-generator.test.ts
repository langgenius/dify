import { describe, expect, it } from "vitest";

import { createSharpImageThumbnailVariantGenerator } from "./document-image-variant-generator";

describe("createSharpImageThumbnailVariantGenerator", () => {
  it.each([0, 319, 4097, Number.NaN])(
    "rejects unsafe analysis dimension %s",
    (analysisMaxDimension) => {
      expect(() => createSharpImageThumbnailVariantGenerator({ analysisMaxDimension })).toThrow(
        "Sharp image analysis dimension",
      );
    },
  );
  it("requires distinct variant names and skips non-image/empty input", async () => {
    expect(() =>
      createSharpImageThumbnailVariantGenerator({
        analysisMaxDimension: 640,
        variantName: "analysis",
      }),
    ).toThrow("distinct variant names");
    const generator = createSharpImageThumbnailVariantGenerator({ analysisMaxDimension: 640 });
    await expect(
      generator.generate({
        body: new Uint8Array([1]),
        contentType: "text/plain",
        elementId: "text",
      }),
    ).resolves.toEqual([]);
    await expect(
      generator.generate({ body: new Uint8Array(), contentType: "image/png", elementId: "empty" }),
    ).resolves.toEqual([]);
  });
  it("keeps a separate analysis image with enough detail instead of feeding the preview thumbnail to vision", async () => {
    const sharp = (await import("sharp")).default;
    const body = await sharp({
      create: { background: "white", channels: 3, width: 800, height: 400 },
    })
      .png()
      .toBuffer();
    const variants = await createSharpImageThumbnailVariantGenerator({
      analysisMaxDimension: 640,
    }).generate({ body, contentType: "image/png", elementId: "figure" });
    expect(variants.map(({ name, width, height }) => ({ name, width, height }))).toEqual([
      { name: "thumbnail", width: 320, height: 160 },
      { name: "analysis", width: 640, height: 320 },
    ]);
  });
  it("generates bounded PNG thumbnail variants from image bytes", async () => {
    const sharp = (await import("sharp")).default;
    const generator = createSharpImageThumbnailVariantGenerator({
      maxDimension: 16,
      variantName: "thumbnail",
    });
    const png = new Uint8Array(
      await sharp({
        create: {
          background: { alpha: 1, b: 0, g: 0, r: 255 },
          channels: 4,
          height: 2,
          width: 2,
        },
      })
        .png()
        .toBuffer(),
    );

    const variants = await generator.generate({
      body: png,
      contentType: "image/png",
      elementId: "figure-1",
    });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      contentType: "image/png",
      height: 2,
      name: "thumbnail",
      width: 2,
    });
    expect(variants[0]?.body.byteLength).toBeGreaterThan(0);
  });

  it("validates thumbnail options", () => {
    expect(() => createSharpImageThumbnailVariantGenerator({ maxDimension: 0 })).toThrow(
      "Sharp image thumbnail maxDimension must be at least 1",
    );
    expect(() => createSharpImageThumbnailVariantGenerator({ maxInputPixels: 0 })).toThrow(
      "Sharp image thumbnail maxInputPixels must be at least 1",
    );
    expect(() => createSharpImageThumbnailVariantGenerator({ maxOutputBytes: 0 })).toThrow(
      "Sharp image thumbnail maxOutputBytes must be at least 1",
    );
    expect(() => createSharpImageThumbnailVariantGenerator({ variantName: "" })).toThrow(
      "Sharp image thumbnail variantName must be non-empty",
    );
  });

  it("rejects compressed images whose decoded dimensions exceed the pixel budget", async () => {
    const generator = createSharpImageThumbnailVariantGenerator({ maxInputPixels: 100 });
    const oversizedSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
    );

    await expect(
      generator.generate({
        body: oversizedSvg,
        contentType: "image/svg+xml",
        elementId: "figure-oversized",
      }),
    ).rejects.toThrow(/pixel limit/iu);
  });

  it("rejects thumbnail variants that exceed the encoded output budget", async () => {
    const sharp = (await import("sharp")).default;
    const generator = createSharpImageThumbnailVariantGenerator({ maxOutputBytes: 1 });
    const png = new Uint8Array(
      await sharp({
        create: {
          background: { alpha: 1, b: 255, g: 0, r: 0 },
          channels: 4,
          height: 2,
          width: 2,
        },
      })
        .png()
        .toBuffer(),
    );

    await expect(
      generator.generate({ body: png, contentType: "image/png", elementId: "figure-output" }),
    ).rejects.toThrow(/output exceeds maxOutputBytes/iu);
  });
});
