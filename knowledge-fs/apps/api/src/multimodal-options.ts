import {
  type DocumentImageVariantGenerator,
  type DocumentPdfRasterizer,
  createPopplerPdfRasterizer,
  createSharpImageThumbnailVariantGenerator,
} from "@knowledge/api";

export interface ApiMultimodalEnv {
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_DPI_OVERRIDE?: string | undefined;
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS_OVERRIDE?: string | undefined;
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE?: string | undefined;
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE?: string | undefined;
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI_OVERRIDE?: string | undefined;
  readonly DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS_OVERRIDE?: string | undefined;
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
  readonly KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY?: string | undefined;
}

export interface ApiMultimodalOptions {
  readonly documentMultimodalImageVariantGenerator?: DocumentImageVariantGenerator;
  readonly documentMultimodalMaxConcurrency: number;
  readonly documentMultimodalMaxPdfRasterizedAssets?: number;
  readonly documentPdfRasterizer?: DocumentPdfRasterizer;
}

export function createApiMultimodalOptions(
  env: ApiMultimodalEnv = process.env,
): ApiMultimodalOptions {
  const rasterizerMode = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER,
  );
  const rasterizerDpi = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_DPI_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER_DPI,
  );
  const rasterizerThumbnailDpi = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI,
  );
  const rasterizerTimeoutMs = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS,
  );
  const rasterizerMaxAssets = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS,
  );
  const rasterizerMaxConcurrency = rootOverride(
    env.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE,
    env.KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY,
  );
  const rasterizerName = normalizedRasterizer(rasterizerMode);
  const command = trimmed(env.KNOWLEDGE_PDF_RASTERIZER_COMMAND);
  const imageVariantOptions = imageThumbnailOptions(env);
  const maxConcurrency = boundedPositiveIntegerEnv(
    rasterizerMaxConcurrency ?? "2",
    "KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY",
    8,
  );
  const maxAssets =
    rasterizerMaxAssets !== undefined
      ? {
          documentMultimodalMaxPdfRasterizedAssets: positiveIntegerEnv(
            rasterizerMaxAssets,
            "KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS",
          ),
        }
      : {};

  if (rasterizerName === "off" || (!rasterizerName && !command)) {
    return {
      ...imageVariantOptions,
      ...maxAssets,
      documentMultimodalMaxConcurrency: maxConcurrency,
    };
  }

  return {
    ...imageVariantOptions,
    ...maxAssets,
    documentMultimodalMaxConcurrency: maxConcurrency,
    documentPdfRasterizer: createPopplerPdfRasterizer({
      ...(command ? { command } : {}),
      ...(rasterizerDpi !== undefined
        ? {
            dpi: positiveIntegerEnv(rasterizerDpi, "KNOWLEDGE_PDF_RASTERIZER_DPI"),
          }
        : {}),
      ...(rasterizerThumbnailDpi !== undefined
        ? {
            thumbnailDpi: positiveIntegerEnv(
              rasterizerThumbnailDpi,
              "KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI",
            ),
          }
        : {}),
      ...(trimmed(env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT)
        ? { thumbnailVariantName: trimmed(env.KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_VARIANT) }
        : {}),
      ...(rasterizerTimeoutMs !== undefined
        ? {
            timeoutMs: positiveIntegerEnv(
              rasterizerTimeoutMs,
              "KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS",
            ),
          }
        : {}),
      maxConcurrency,
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

function boundedPositiveIntegerEnv(value: string | undefined, name: string, max: number): number {
  const parsed = positiveIntegerEnv(value, name);

  if (parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }

  return parsed;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}

function rootOverride(
  proxyValue: string | undefined,
  serviceValue: string | undefined,
): string | undefined {
  return trimmed(proxyValue) ?? serviceValue;
}
