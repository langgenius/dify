export interface GenerateDocumentImageVariantsInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly elementId: string;
  readonly signal?: AbortSignal | undefined;
}

export interface GeneratedDocumentImageVariant {
  readonly execution?:
    | {
        readonly isolation: "child-process";
        readonly inputBytes: number;
        readonly outputBytes: number;
        readonly wallMs: number;
        readonly peakRssKiB: number;
      }
    | undefined;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly height?: number | undefined;
  readonly name: string;
  readonly width?: number | undefined;
}

export interface DocumentImageVariantGenerator {
  generate(
    input: GenerateDocumentImageVariantsInput,
  ): Promise<readonly GeneratedDocumentImageVariant[]>;
}

export interface SharpImageThumbnailVariantGeneratorOptions {
  /** Separate vision input; preview dimensions must never become model input resolution. */
  readonly analysisMaxDimension?: number | undefined;
  readonly maxDimension?: number | undefined;
  readonly maxInputPixels?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly variantName?: string | undefined;
}

const defaultThumbnailMaxDimension = 320;
const defaultThumbnailMaxInputPixels = 20_000_000;
const defaultThumbnailMaxOutputBytes = 8 * 1024 * 1024;
const defaultThumbnailVariantName = "thumbnail";

export function createSharpImageThumbnailVariantGenerator({
  analysisMaxDimension,
  maxDimension = defaultThumbnailMaxDimension,
  maxInputPixels = defaultThumbnailMaxInputPixels,
  maxOutputBytes = defaultThumbnailMaxOutputBytes,
  variantName = defaultThumbnailVariantName,
}: SharpImageThumbnailVariantGeneratorOptions = {}): DocumentImageVariantGenerator {
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1) {
    throw new Error("Sharp image thumbnail maxDimension must be at least 1");
  }

  if (!Number.isSafeInteger(maxInputPixels) || maxInputPixels < 1) {
    throw new Error("Sharp image thumbnail maxInputPixels must be at least 1");
  }

  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error("Sharp image thumbnail maxOutputBytes must be at least 1");
  }

  if (!variantName.trim()) {
    throw new Error("Sharp image thumbnail variantName must be non-empty");
  }

  if (
    analysisMaxDimension !== undefined &&
    (!Number.isSafeInteger(analysisMaxDimension) ||
      analysisMaxDimension < maxDimension ||
      analysisMaxDimension > 4096 ||
      variantName === "analysis")
  ) {
    throw new Error(
      "Sharp image analysis dimension must be between thumbnail dimension and 4096, with distinct variant names",
    );
  }

  if (analysisMaxDimension !== undefined) {
    const analysisGenerator = createSharpImageThumbnailVariantGenerator({
      maxDimension: analysisMaxDimension,
      maxInputPixels,
      maxOutputBytes,
      variantName: "analysis",
    });
    const previewGenerator = createSharpImageThumbnailVariantGenerator({
      maxDimension,
      maxInputPixels,
      maxOutputBytes,
      variantName,
    });
    return {
      generate: async (input) => {
        input.signal?.throwIfAborted();
        const analysis = await analysisGenerator.generate(input);
        const main = analysis[0];
        if (!main) return [];
        const preview = await previewGenerator.generate({
          ...input,
          body: main.body,
          contentType: main.contentType,
        });
        return [...preview, ...analysis];
      },
    };
  }

  return {
    generate: async ({ body, contentType, signal }) => {
      signal?.throwIfAborted();
      if (!contentType.toLowerCase().startsWith("image/") || body.byteLength === 0) {
        return [];
      }

      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(body, { limitInputPixels: maxInputPixels })
        .rotate()
        .resize({
          fit: "inside",
          height: maxDimension,
          width: maxDimension,
          withoutEnlargement: true,
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      signal?.throwIfAborted();

      if (data.byteLength > maxOutputBytes) {
        throw new Error(
          `Sharp image thumbnail output exceeds maxOutputBytes (${data.byteLength} > ${maxOutputBytes})`,
        );
      }

      return [
        {
          body: new Uint8Array(data),
          contentType: "image/png",
          height: info.height,
          name: variantName,
          width: info.width,
        },
      ];
    },
  };
}
