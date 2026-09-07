import { describe, expect, it } from "vitest";
import { createIsolatedImageVariantGenerator } from "./isolated-image-variant-generator";

describe("isolated image variants", () => {
  it("rejects incompatible variant names before starting any image work", () => {
    expect(() => createIsolatedImageVariantGenerator({ variantName: "../escape" })).toThrow(
      "Image variant name",
    );
  });
  it("decodes in a child and returns separate preview and analysis variants", async () => {
    const sharp = (await import("sharp")).default;
    const body = await sharp({
      create: { width: 640, height: 320, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const generator = createIsolatedImageVariantGenerator({ analysisMaxDimension: 512 });
    const variants = await generator.generate({
      body,
      contentType: "image/png",
      elementId: "figure",
    });
    expect(variants.map(({ name, width, height }) => ({ name, width, height }))).toEqual([
      { name: "thumbnail", width: 320, height: 160 },
      { name: "analysis", width: 512, height: 256 },
    ]);
    expect(variants[0]?.execution).toMatchObject({
      isolation: "child-process",
      inputBytes: body.byteLength,
      outputBytes: expect.any(Number),
      wallMs: expect.any(Number),
      peakRssKiB: expect.any(Number),
    });
  });
  it("returns a terminal input error when the decoder rejects pixels", async () => {
    const generator = createIsolatedImageVariantGenerator({ maxInputPixels: 100 });
    await expect(
      generator.generate({
        body: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
        ),
        contentType: "image/svg+xml",
        elementId: "too-large",
      }),
    ).rejects.toMatchObject({ code: "provider_input", retryable: false });
  });
  it("does not start a decoder after the execution lease was cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    await expect(
      createIsolatedImageVariantGenerator().generate({
        body: new Uint8Array([1]),
        contentType: "image/png",
        elementId: "cancelled",
        signal: controller.signal,
      }),
    ).rejects.toThrow("lease lost");
  });
});
