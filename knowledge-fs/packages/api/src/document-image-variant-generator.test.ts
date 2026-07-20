import { describe, expect, it } from "vitest";

import { createSharpImageThumbnailVariantGenerator } from "./document-image-variant-generator";

describe("createSharpImageThumbnailVariantGenerator", () => {
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
    expect(() => createSharpImageThumbnailVariantGenerator({ variantName: "" })).toThrow(
      "Sharp image thumbnail variantName must be non-empty",
    );
  });
});
