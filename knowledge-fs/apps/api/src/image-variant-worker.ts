import { createSharpImageThumbnailVariantGenerator } from "../../../packages/api/src/document-image-variant-generator";
import {
  type ImageVariantRequest,
  type ImageVariantResponse,
  imageVariantMaxInputBytes,
  imageVariantMaxOutputBytes,
  isImageInputRejection,
} from "./image-variant-protocol";

process.once("message", async (request: ImageVariantRequest) => {
  const started = performance.now();
  let response: ImageVariantResponse;
  try {
    if (
      !(request.input.body instanceof Uint8Array) ||
      request.input.body.byteLength > imageVariantMaxInputBytes
    )
      throw new Error("Image worker input exceeds its byte budget");
    const variants = await createSharpImageThumbnailVariantGenerator(request.options).generate(
      request.input,
    );
    if (
      variants.reduce((sum, variant) => sum + variant.body.byteLength, 0) >
      imageVariantMaxOutputBytes
    )
      throw new Error("Image variants exceed the output byte budget");
    const execution = {
      isolation: "child-process" as const,
      inputBytes: request.input.body.byteLength,
      outputBytes: variants.reduce((sum, variant) => sum + variant.body.byteLength, 0),
      wallMs: performance.now() - started,
      peakRssKiB: process.resourceUsage().maxRSS,
    };
    response = { ok: true, variants: variants.map((variant) => ({ ...variant, execution })) };
  } catch (error) {
    if (!isImageInputRejection(error)) throw error;
    response = {
      ok: false,
      message:
        error instanceof Error ? error.message.slice(0, 1024) : "Image variant generation failed",
    };
  }
  process.send?.(response, () => process.disconnect());
});
