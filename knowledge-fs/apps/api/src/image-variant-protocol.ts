import type {
  GenerateDocumentImageVariantsInput,
  GeneratedDocumentImageVariant,
  SharpImageThumbnailVariantGeneratorOptions,
} from "../../../packages/api/src/document-image-variant-generator";

export interface ImageVariantRequest {
  readonly input: Omit<GenerateDocumentImageVariantsInput, "signal">;
  readonly options: SharpImageThumbnailVariantGeneratorOptions;
}
export type ImageVariantResponse =
  | { readonly ok: true; readonly variants: readonly GeneratedDocumentImageVariant[] }
  | { readonly ok: false; readonly message: string };
export const imageVariantMaxInputBytes = 50 * 1024 * 1024;
export const imageVariantMaxOutputBytes = 16 * 1024 * 1024;

/** Unknown/native initialization errors remain operational failures instead of silently omitting media. */
export function isImageInputRejection(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /^(?:Input (?:image exceeds pixel limit|buffer (?:contains unsupported image format|has corrupt header))|Sharp image thumbnail output exceeds maxOutputBytes|Image variants exceed the output byte budget)/u.test(
      error.message,
    )
  );
}

export function validateImageVariantResponse(value: unknown): value is ImageVariantResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("ok" in value))
    return false;
  if (value.ok === false)
    return (
      "message" in value &&
      typeof value.message === "string" &&
      value.message.length > 0 &&
      value.message.length <= 1024
    );
  if (
    value.ok !== true ||
    !("variants" in value) ||
    !Array.isArray(value.variants) ||
    value.variants.length > 2
  )
    return false;
  let bytes = 0;
  const names = new Set<string>();
  for (const variant of value.variants) {
    if (
      typeof variant !== "object" ||
      variant === null ||
      !(variant.body instanceof Uint8Array) ||
      variant.body.byteLength === 0 ||
      variant.contentType !== "image/png" ||
      typeof variant.name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/u.test(variant.name) ||
      names.has(variant.name)
    )
      return false;
    if (variant.execution !== undefined) {
      const execution = variant.execution;
      if (
        typeof execution !== "object" ||
        execution === null ||
        execution.isolation !== "child-process" ||
        !Number.isSafeInteger(execution.inputBytes) ||
        execution.inputBytes < 0 ||
        execution.inputBytes > imageVariantMaxInputBytes ||
        !Number.isSafeInteger(execution.outputBytes) ||
        execution.outputBytes < 0 ||
        execution.outputBytes > imageVariantMaxOutputBytes ||
        !Number.isFinite(execution.wallMs) ||
        execution.wallMs < 0 ||
        !Number.isSafeInteger(execution.peakRssKiB) ||
        execution.peakRssKiB < 0
      )
        return false;
    }
    if (
      (variant.width !== undefined &&
        (!Number.isSafeInteger(variant.width) || variant.width < 1)) ||
      (variant.height !== undefined &&
        (!Number.isSafeInteger(variant.height) || variant.height < 1))
    )
      return false;
    names.add(variant.name);
    bytes += variant.body.byteLength;
    if (bytes > imageVariantMaxOutputBytes) return false;
  }
  return true;
}
