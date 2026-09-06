import { fork } from "node:child_process";
import { ProviderInputError, ProviderResponseError } from "@knowledge/parsers";
import {
  type DocumentImageVariantGenerator,
  type GeneratedDocumentImageVariant,
  type SharpImageThumbnailVariantGeneratorOptions,
  createSharpImageThumbnailVariantGenerator,
} from "../../../packages/api/src/document-image-variant-generator";
import {
  type ImageVariantRequest,
  type ImageVariantResponse,
  imageVariantMaxInputBytes,
  validateImageVariantResponse,
} from "./image-variant-protocol";
import { createIsolatedProcessExecutor } from "./isolated-process-executor";

const executor = createIsolatedProcessExecutor<ImageVariantRequest, ImageVariantResponse>({
  maxConcurrency: 2,
  maxInputBytes: imageVariantMaxInputBytes,
  maxReservedBytes: 64 * 1024 * 1024,
  maxRssBytes: 384 * 1024 * 1024,
  maxQueued: 8,
  timeoutMs: 30_000,
  spawn: () => {
    const compiled = import.meta.url.endsWith(".mjs");
    return fork(
      new URL(
        compiled ? "./image-variant-worker.mjs" : "./image-variant-worker.ts",
        import.meta.url,
      ),
      [],
      {
        execArgv: ["--max-old-space-size=128", ...(compiled ? [] : ["--import", "tsx"])],
        env: {
          PATH: process.env.PATH,
          SYSTEMROOT: process.env.SYSTEMROOT,
          VIPS_CONCURRENCY: "1",
          MALLOC_ARENA_MAX: "2",
        },
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
  },
});

export function imageVariantsFromResponse(
  value: unknown,
): readonly GeneratedDocumentImageVariant[] {
  if (!validateImageVariantResponse(value))
    throw new ProviderResponseError("Image worker returned an invalid or over-budget response");
  if (!value.ok) throw new ProviderInputError(value.message);
  return value.variants;
}

export function createIsolatedImageVariantGenerator(
  options: SharpImageThumbnailVariantGeneratorOptions = {},
): DocumentImageVariantGenerator {
  createSharpImageThumbnailVariantGenerator(options); // Validate configuration before accepting jobs.
  if (options.variantName !== undefined && !/^[a-zA-Z0-9_-]{1,64}$/u.test(options.variantName))
    throw new Error(
      "Image variant name must contain 1..64 ASCII letters, digits, hyphens or underscores",
    );
  const frozenOptions = Object.freeze({ ...options });
  return {
    generate: async ({ signal, ...input }) => {
      const response = await executor.execute(
        { input, options: frozenOptions },
        input.body.byteLength,
        signal,
      );
      return imageVariantsFromResponse(response);
    },
  };
}
