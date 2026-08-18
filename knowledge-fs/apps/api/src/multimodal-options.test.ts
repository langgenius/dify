import { createPopplerPdfRasterizer } from "@knowledge/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@knowledge/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@knowledge/api")>();

  return {
    ...actual,
    createPopplerPdfRasterizer: vi.fn(actual.createPopplerPdfRasterizer),
  };
});

import { createApiMultimodalOptions } from "./multimodal-options";

describe("createApiMultimodalOptions", () => {
  beforeEach(() => {
    vi.mocked(createPopplerPdfRasterizer).mockClear();
  });

  it("leaves PDF rasterization disabled by default or when explicitly off", () => {
    const defaults = createApiMultimodalOptions({});
    expect(defaults.documentPdfRasterizer).toBeUndefined();
    expect(defaults.documentMultimodalImageVariantGenerator).toBeDefined();
    expect(defaults.documentMultimodalMaxConcurrency).toBe(2);
    expect(createApiMultimodalOptions({ KNOWLEDGE_PDF_RASTERIZER: "off" })).toMatchObject({
      documentMultimodalImageVariantGenerator: expect.any(Object),
    });
    expect(createApiMultimodalOptions({ KNOWLEDGE_PDF_RASTERIZER: "false" })).toMatchObject({
      documentMultimodalImageVariantGenerator: expect.any(Object),
    });
  });

  it("can disable or configure non-PDF image thumbnails", () => {
    expect(createApiMultimodalOptions({ KNOWLEDGE_IMAGE_THUMBNAILS: "off" })).toEqual({
      documentMultimodalMaxConcurrency: 2,
    });
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
      KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: "3",
      KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: "64",
      KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT: "small",
      KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS: "5000",
    });

    expect(options.documentPdfRasterizer).toBeDefined();
    expect(options.documentMultimodalMaxConcurrency).toBe(3);
    expect(options.documentMultimodalMaxPdfRasterizedAssets).toBe(25);
    expect(createPopplerPdfRasterizer).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 3 }),
    );
  });

  it("uses service-specific PDF values when root override proxies are empty", () => {
    const options = createApiMultimodalOptions({
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE: " ",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE: "",
      KNOWLEDGE_PDF_RASTERIZER: "poppler",
      KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: "4",
    });

    expect(options.documentPdfRasterizer).toBeDefined();
    expect(options.documentMultimodalMaxConcurrency).toBe(4);
    expect(createPopplerPdfRasterizer).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 4 }),
    );
  });

  it("lets whitelisted root proxies override service-specific PDF values", () => {
    const options = createApiMultimodalOptions({
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_DPI_OVERRIDE: "180",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS_OVERRIDE: "11",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE: "3",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE: "poppler",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI_OVERRIDE: "60",
      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS_OVERRIDE: "7000",
      KNOWLEDGE_PDF_RASTERIZER: "off",
      KNOWLEDGE_PDF_RASTERIZER_DPI: "100",
      KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS: "10",
      KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: "7",
      KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: "40",
      KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS: "6000",
    });

    expect(options.documentMultimodalMaxPdfRasterizedAssets).toBe(11);
    expect(options.documentMultimodalMaxConcurrency).toBe(3);
    expect(createPopplerPdfRasterizer).toHaveBeenCalledWith(
      expect.objectContaining({
        dpi: 180,
        maxConcurrency: 3,
        thumbnailDpi: 60,
        timeoutMs: 7000,
      }),
    );

    vi.mocked(createPopplerPdfRasterizer).mockClear();
    expect(
      createApiMultimodalOptions({
        DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE: "off",
        KNOWLEDGE_PDF_RASTERIZER: "poppler",
      }).documentPdfRasterizer,
    ).toBeUndefined();
    expect(createPopplerPdfRasterizer).not.toHaveBeenCalled();
  });

  it("creates a Poppler rasterizer when a command path is configured", () => {
    const options = createApiMultimodalOptions({
      KNOWLEDGE_PDF_RASTERIZER_COMMAND: "/opt/homebrew/bin/pdftoppm",
    });

    expect(options.documentPdfRasterizer).toBeDefined();
    expect(createPopplerPdfRasterizer).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrency: 2 }),
    );
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
    for (const value of ["0", "9", "1.5", "many"]) {
      expect(() =>
        createApiMultimodalOptions({
          KNOWLEDGE_PDF_RASTERIZER: "poppler",
          KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: value,
        }),
      ).toThrow(/KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY must be/u);
    }
    expect(() =>
      createApiMultimodalOptions({
        DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE: "9",
        DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE: "poppler",
      }),
    ).toThrow("KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY must be an integer between 1 and 8");
  });
});
