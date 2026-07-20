export interface GenerateDocumentImageVariantsInput {
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly elementId: string;
}

export interface GeneratedDocumentImageVariant {
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
  readonly maxDimension?: number | undefined;
  readonly variantName?: string | undefined;
}

const defaultThumbnailMaxDimension = 320;
const defaultThumbnailVariantName = "thumbnail";

export function createSharpImageThumbnailVariantGenerator({
  maxDimension = defaultThumbnailMaxDimension,
  variantName = defaultThumbnailVariantName,
}: SharpImageThumbnailVariantGeneratorOptions = {}): DocumentImageVariantGenerator {
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1) {
    throw new Error("Sharp image thumbnail maxDimension must be at least 1");
  }

  if (!variantName.trim()) {
    throw new Error("Sharp image thumbnail variantName must be non-empty");
  }

  return {
    generate: async ({ body, contentType }) => {
      if (!contentType.toLowerCase().startsWith("image/") || body.byteLength === 0) {
        return [];
      }

      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(body)
        .rotate()
        .resize({
          fit: "inside",
          height: maxDimension,
          width: maxDimension,
          withoutEnlargement: true,
        })
        .png()
        .toBuffer({ resolveWithObject: true });

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
