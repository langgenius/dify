import {
  type DocumentImageVariantGenerator,
  type DocumentPdfRasterizer,
  createPopplerPdfRasterizer,
  createSharpImageThumbnailVariantGenerator,
} from "@knowledge/api";

export interface ApiMultimodalEnv {
  readonly KNOWLEDGE_IMAGE_THUMBNAILS?: string | undefined;
  readonly KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION?: string | undefined;
  readonly KNOWLEDGE_IMAGE_THUMBNAIL_VARIANT?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_COMMAND?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_DPI?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS?: string | undefined;
  readonly KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS?: string | undefined;
}

export interface ApiMultimodalOptions {
  readonly documentMultimodalImageVariantGenerator?: DocumentImageVariantGenerator;
  readonly documentMultimodalMaxPdfRasterizedAssets?: number;
  readonly documentPdfRasterizer?: DocumentPdfRasterizer;
}

export function createApiMultimodalOptions(
  env: ApiMultimodalEnv = process.env,
): ApiMultimodalOptions {
  const rasterizerName = normalizedRasterizer(env.KNOWLEDGE_PDF_RASTERIZER);
  const command = trimmed(env.KNOWLEDGE_PDF_RASTERIZER_COMMAND);
  const imageVariantOptions = imageThumbnailOptions(env);
  const maxAssets =
    env.KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS !== undefined
      ? {
          documentMultimodalMaxPdfRasterizedAssets: positiveIntegerEnv(
            env.KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS,
            "KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS",
          ),
        }
      : {};

  if (rasterizerName === "off" || (!rasterizerName && !command)) {
    return {
      ...imageVariantOptions,
      ...maxAssets,
    };
  }

  return {
    ...imageVariantOptions,
    ...maxAssets,
    documentPdfRasterizer: createPopplerPdfRasterizer({
      ...(command ? { command } : {}),
      ...(env.KNOWLEDGE_PDF_RASTERIZER_DPI !== undefined
        ? {
            dpi: positiveIntegerEnv(
              env.KNOWLEDGE_PDF_RASTERIZER_DPI,
              "KNOWLEDGE_PDF_RASTERIZER_DPI",
            ),
          }
        : {}),
      ...(env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI !== undefined
        ? {
            thumbnailDpi: positiveIntegerEnv(
              env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI,
              "KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI",
            ),
          }
        : {}),
      ...(trimmed(env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT)
        ? { thumbnailVariantName: trimmed(env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT) }
        : {}),
      ...(env.KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS !== undefined
        ? {
            timeoutMs: positiveIntegerEnv(
              env.KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS,
              "KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS",
            ),
          }
        : {}),
    }),
  };
}

function imageThumbnailOptions(
  env: ApiMultimodalEnv,
): Pick<ApiMultimodalOptions, "documentMultimodalImageVariantGenerator"> {
  const mode = normalizedImageThumbnails(env.KNOWLEDGE_IMAGE_THUMBNAILS);

  if (mode === "off") {
    return {};
  }

  return {
    documentMultimodalImageVariantGenerator: createSharpImageThumbnailVariantGenerator({
      ...(env.KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION !== undefined
        ? {
            maxDimension: positiveIntegerEnv(
              env.KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION,
              "KNOWLEDGE_IMAGE_THUMBNAIL_MAX_DIMENSION",
            ),
          }
        : {}),
      ...(trimmed(env.KNOWLEDGE_IMAGE_THUMBNAIL_VARIANT)
        ? { variantName: trimmed(env.KNOWLEDGE_IMAGE_THUMBNAIL_VARIANT) }
        : {}),
    }),
  };
}

function normalizedRasterizer(value: string | undefined): "off" | "poppler" | undefined {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }

  if (normalized === "poppler") {
    return normalized;
  }

  throw new Error("KNOWLEDGE_PDF_RASTERIZER must be poppler or off");
}

function normalizedImageThumbnails(value: string | undefined): "off" | "sharp" {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized) {
    return "sharp";
  }

  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return "off";
  }

  if (normalized === "1" || normalized === "true" || normalized === "sharp") {
    return "sharp";
  }

  throw new Error("KNOWLEDGE_IMAGE_THUMBNAILS must be sharp or off");
}

function positiveIntegerEnv(value: string | undefined, name: string): number {
  const raw = trimmed(value);

  if (!raw || !/^\d+$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
