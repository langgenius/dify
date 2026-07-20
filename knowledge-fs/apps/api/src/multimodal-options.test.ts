import { describe, expect, it } from "vitest";

import { createApiMultimodalOptions } from "./multimodal-options";

describe("createApiMultimodalOptions", () => {
  it("leaves PDF rasterization disabled by default or when explicitly off", () => {
    expect(createApiMultimodalOptions({}).documentPdfRasterizer).toBeUndefined();
    expect(createApiMultimodalOptions({}).documentMultimodalImageVariantGenerator).toBeDefined();
    expect(createApiMultimodalOptions({ KNOWLEDGE_PDF_RASTERIZER: "off" })).toMatchObject({
      documentMultimodalImageVariantGenerator: expect.any(Object),
    });
    expect(createApiMultimodalOptions({ KNOWLEDGE_PDF_RASTERIZER: "false" })).toMatchObject({
      documentMultimodalImageVariantGenerator: expect.any(Object),
    });
  });

  it("can disable or configure non-PDF image thumbnails", () => {
    expect(createApiMultimodalOptions({ KNOWLEDGE_IMAGE_THUMBNAILS: "off" })).toEqual({});
    expect(
      createApiMultimodalOptions({
        KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION: "96",
        KNOWLEDGE_IMAGE_THUMBNAIL_VARIANT: "small",
        KNOWLEDGE_IMAGE_THUMBNAILS: "sharp",
      }).documentMultimodalImageVariantGenerator,
    ).toBeDefined();
  });

  it("creates a Poppler rasterizer when explicitly requested", () => {
    const options = createApiMultimodalOptions({
      KNOWLEDGE_PDF_RASTERIZER: "poppler",
      KNOWLEDGE_PDF_RASTERIZER_DPI: "200",
      KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS: "25",
      KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: "64",
      KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT: "small",
      KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS: "5000",
    });

    expect(options.documentPdfRasterizer).toBeDefined();
    expect(options.documentMultimodalMaxPdfRasterizedAssets).toBe(25);
  });

  it("creates a Poppler rasterizer when a command path is configured", () => {
    const options = createApiMultimodalOptions({
      KNOWLEDGE_PDF_RASTERIZER_COMMAND: "/opt/homebrew/bin/pdftoppm",
    });

    expect(options.documentPdfRasterizer).toBeDefined();
  });

  it("rejects invalid rasterizer environment values", () => {
    expect(() => createApiMultimodalOptions({ KNOWLEDGE_PDF_RASTERIZER: "imagemagick" })).toThrow(
      "KNOWLEDGE_PDF_RASTERIZER must be poppler or off",
    );
    expect(() =>
      createApiMultimodalOptions({
        KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION: "0",
      }),
    ).toThrow("KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION must be a positive integer");
    expect(() =>
      createApiMultimodalOptions({
        KNOWLEDGE_IMAGE_THUMBNAILS: "imagemagick",
      }),
    ).toThrow("KNOWLEDGE_IMAGE_THUMBNAILS must be sharp or off");
    expect(() =>
      createApiMultimodalOptions({
        KNOWLEDGE_PDF_RASTERIZER: "poppler",
        KNOWLEDGE_PDF_RASTERIZER_DPI: "0",
      }),
    ).toThrow("KNOWLEDGE_PDF_RASTERIZER_DPI must be a positive integer");
    expect(() =>
      createApiMultimodalOptions({
        KNOWLEDGE_PDF_RASTERIZER: "poppler",
        KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: "0",
      }),
    ).toThrow("KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI must be a positive integer");
    expect(() =>
      createApiMultimodalOptions({
        KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS: "many",
      }),
    ).toThrow("KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS must be a positive integer");
  });
});
