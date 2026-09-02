import { createHash } from "node:crypto";

import {
  QUERY_IMAGE_MAX_BYTES,
  QUERY_IMAGE_MAX_TOTAL_BYTES,
  QueryImageMimeTypeSchema,
  QueryImageResolutionError,
  type QueryImageResolver,
  type ResolvedQueryImage,
  assertResolvedQueryImages,
} from "@knowledge/api";

export interface ApiQueryImageEnv {
  readonly DIFY_INNER_API_KEY?: string | undefined;
  readonly DIFY_INNER_API_URL?: string | undefined;
}

const DEFAULT_DIFY_INNER_API_URL = "http://localhost:5001";
const DEFAULT_DIFY_INNER_API_KEY = "QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1";

/** Resolves authorized Dify file references without giving KnowledgeFS direct storage access. */
export function createApiQueryImageResolver({
  env = process.env,
  fetch = globalThis.fetch,
}: {
  readonly env?: ApiQueryImageEnv | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
} = {}): QueryImageResolver {
  const baseUrl = normalizedBaseUrl(env.DIFY_INNER_API_URL ?? DEFAULT_DIFY_INNER_API_URL);
  const apiKey = required(
    env.DIFY_INNER_API_KEY ?? DEFAULT_DIFY_INNER_API_KEY,
    "DIFY_INNER_API_KEY",
  );

  return {
    resolve: async ({ references, signal, subjectId, tenantId }) => {
      let aggregateBytes = 0;
      const images: ResolvedQueryImage[] = [];

      // Sequential loading keeps the aggregate memory bound deterministic and the endpoint's
      // actor checks cheap. Model embedding still batches the successfully resolved images.
      for (const reference of references) {
        const url = new URL("/inner/api/knowledge-fs/query-image", baseUrl);
        url.searchParams.set("subjectId", subjectId);
        url.searchParams.set("tenantId", tenantId);
        url.searchParams.set("uploadFileId", reference.uploadFileId);
        let response: Response;
        try {
          response = await fetch(url, {
            headers: {
              "X-Inner-Api-Key": apiKey,
              ...(reference.accessGrant
                ? { "X-Knowledge-FS-Query-Image-Grant": reference.accessGrant }
                : {}),
            },
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          throw new QueryImageResolutionError(
            "QUERY_IMAGE_UPSTREAM_UNAVAILABLE",
            "Dify query-image storage is unavailable",
            503,
            { cause: error },
          );
        }
        if (!response.ok) {
          throw queryImageHttpError(response.status);
        }

        const declaredLengthHeader = response.headers.get("content-length");
        const declaredLength =
          declaredLengthHeader === null ? undefined : Number(declaredLengthHeader);
        if (
          declaredLength !== undefined &&
          (!Number.isSafeInteger(declaredLength) || declaredLength < 1)
        ) {
          throw new QueryImageResolutionError(
            "QUERY_IMAGE_SIZE_INVALID",
            "Query image content length is invalid",
            400,
          );
        }
        if (declaredLength !== undefined && declaredLength > QUERY_IMAGE_MAX_BYTES) {
          throw queryImageBodyLimitError("image");
        }
        const mimeType = QueryImageMimeTypeSchema.safeParse(
          response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
        );
        if (!mimeType.success) {
          throw new QueryImageResolutionError(
            "QUERY_IMAGE_MIME_UNSUPPORTED",
            "Query image MIME type is not supported",
            400,
          );
        }
        const remainingBytes = QUERY_IMAGE_MAX_TOTAL_BYTES - aggregateBytes;
        if (declaredLength !== undefined && declaredLength > remainingBytes) {
          throw queryImageBodyLimitError("aggregate");
        }
        const body = await readBoundedBody(
          response,
          Math.min(QUERY_IMAGE_MAX_BYTES, remainingBytes),
          remainingBytes < QUERY_IMAGE_MAX_BYTES ? "aggregate" : "image",
        );
        aggregateBytes += body.byteLength;
        const sha256 = createHash("sha256").update(body).digest("hex");
        const expectedSha256 = response.headers.get("x-query-image-sha256")?.trim().toLowerCase();
        if (!expectedSha256 || expectedSha256 !== sha256) {
          throw new QueryImageResolutionError(
            "QUERY_IMAGE_CHECKSUM_MISMATCH",
            "Query image checksum does not match Dify storage",
            503,
          );
        }
        images.push({
          body,
          byteSize: body.byteLength,
          mimeType: mimeType.data,
          sha256,
          uploadFileId: reference.uploadFileId,
        });
      }

      return assertResolvedQueryImages(images);
    },
  };
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  limitKind: "aggregate" | "image",
): Promise<Uint8Array> {
  if (maxBytes < 1) {
    throw queryImageBodyLimitError("aggregate");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new QueryImageResolutionError("QUERY_IMAGE_EMPTY", "Query image is empty", 400);
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw queryImageBodyLimitError(limitKind);
    }
    chunks.push(chunk.value);
  }
  if (totalBytes < 1) {
    throw new QueryImageResolutionError("QUERY_IMAGE_EMPTY", "Query image is empty", 400);
  }
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function queryImageBodyLimitError(kind: "aggregate" | "image"): QueryImageResolutionError {
  return kind === "aggregate"
    ? new QueryImageResolutionError(
        "QUERY_IMAGE_TOTAL_TOO_LARGE",
        `Query images exceed aggregate max bytes ${QUERY_IMAGE_MAX_TOTAL_BYTES}`,
        413,
      )
    : new QueryImageResolutionError(
        "QUERY_IMAGE_TOO_LARGE",
        `Query image exceeds max bytes ${QUERY_IMAGE_MAX_BYTES}`,
        413,
      );
}

function queryImageHttpError(status: number): QueryImageResolutionError {
  if (status === 404) {
    return new QueryImageResolutionError("QUERY_IMAGE_NOT_FOUND", "Query image was not found", 404);
  }
  if (status === 400) {
    return new QueryImageResolutionError("QUERY_IMAGE_INVALID", "Query image is invalid", 400);
  }
  if (status === 413) {
    return new QueryImageResolutionError("QUERY_IMAGE_TOO_LARGE", "Query image is too large", 413);
  }
  return new QueryImageResolutionError(
    "QUERY_IMAGE_UPSTREAM_UNAVAILABLE",
    "Dify query-image storage is unavailable",
    503,
  );
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(required(value, "DIFY_INNER_API_URL"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("DIFY_INNER_API_URL is invalid");
  }
  return url.href;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}
