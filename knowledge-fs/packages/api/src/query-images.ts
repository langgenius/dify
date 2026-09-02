import { z } from "@hono/zod-openapi";
import type { JobPayload } from "@knowledge/core";

export const QUERY_IMAGE_MAX_COUNT = 4;
export const QUERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const QUERY_IMAGE_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER = "x-knowledge-fs-query-image-grants";
export const KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES = 6 * 1024;

export const QueryImageMimeTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type QueryImageMimeType = z.infer<typeof QueryImageMimeTypeSchema>;

export const QueryImageReferenceSchema = z
  .object({
    uploadFileId: z.string().uuid(),
  })
  .strict();

export const QueryImageReferencesSchema = z
  .array(QueryImageReferenceSchema)
  .max(QUERY_IMAGE_MAX_COUNT)
  .superRefine((references, context) => {
    const seen = new Set<string>();
    for (const [index, reference] of references.entries()) {
      if (seen.has(reference.uploadFileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "queryImages must not contain duplicate uploadFileId values",
          path: [index, "uploadFileId"],
        });
      }
      seen.add(reference.uploadFileId);
    }
  });

export type QueryImageReference = z.infer<typeof QueryImageReferenceSchema>;

/** Transient resolver input. accessGrant is never copied into traces, checkpoints, or evidence. */
export const QueryImageResolutionReferenceSchema = QueryImageReferenceSchema.extend({
  accessGrant: z.string().min(1).max(2_048).optional(),
}).strict();

export type QueryImageResolutionReference = z.infer<typeof QueryImageResolutionReferenceSchema>;

export interface QueryImageMetadata extends QueryImageReference {
  readonly byteSize: number;
  readonly mimeType: QueryImageMimeType;
  readonly sha256: string;
}

/** Bytes resolved from Dify's unified UploadFile storage for the lifetime of one query run. */
export interface ResolvedQueryImage extends QueryImageMetadata {
  readonly body: Uint8Array;
}

export interface QueryImageResolver {
  resolve(input: {
    readonly references: readonly QueryImageResolutionReference[];
    readonly signal?: AbortSignal | undefined;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<readonly ResolvedQueryImage[]>;
}

export const QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE = "query-image-visual-leg-unavailable";
export const QUERY_IMAGE_IGNORED_NO_VISION_MODEL = "query-image-ignored-no-vision-model";
export const QUERY_IMAGE_EXPANSION_TIMEOUT = "query-image-expansion-timeout";

/** Server-owned durable Research metadata. Raw image bytes are never persisted. */
export const QUERY_IMAGE_REFERENCES_METADATA_KEY = "__knowledgeFsQueryImages";
export const QUERY_IMAGE_EXPANSION_METADATA_KEY = "__knowledgeFsQueryImageExpansion";

export const QueryImageDegradationReasonSchema = z.enum([
  QUERY_IMAGE_EXPANSION_TIMEOUT,
  QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
  QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE,
]);

export class QueryImageResolutionError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 413 | 503;

  constructor(
    code: string,
    message: string,
    status: 400 | 404 | 413 | 503,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "QueryImageResolutionError";
    this.code = code;
    this.status = status;
  }
}

const QueryImageGrantEnvelopeSchema = z
  .object({
    g: z.array(z.string().min(1).max(2_048).nullable()).max(QUERY_IMAGE_MAX_COUNT),
    v: z.literal(1),
  })
  .strict();

export function queryImageResolutionReferencesFromHeader(input: {
  readonly encodedGrants?: string | undefined;
  readonly references: readonly QueryImageReference[];
  readonly subjectId: string;
}): readonly QueryImageResolutionReference[] {
  if (!input.encodedGrants) return input.references;
  if (
    !input.subjectId.startsWith("dify-app:") ||
    Buffer.byteLength(input.encodedGrants, "ascii") >
      KNOWLEDGE_FS_QUERY_IMAGE_GRANTS_HEADER_MAX_BYTES ||
    !/^[A-Za-z0-9_-]+$/u.test(input.encodedGrants)
  ) {
    throw invalidQueryImageGrantHeader();
  }

  try {
    const parsed = QueryImageGrantEnvelopeSchema.parse(
      JSON.parse(Buffer.from(input.encodedGrants, "base64url").toString("utf8")) as unknown,
    );
    if (parsed.g.length !== input.references.length) throw invalidQueryImageGrantHeader();
    return input.references.map((reference, index) => {
      const accessGrant = parsed.g[index];
      return accessGrant ? { ...reference, accessGrant } : reference;
    });
  } catch (error) {
    if (error instanceof QueryImageResolutionError) throw error;
    throw invalidQueryImageGrantHeader(error);
  }
}

function invalidQueryImageGrantHeader(cause?: unknown): QueryImageResolutionError {
  return new QueryImageResolutionError(
    "QUERY_IMAGE_GRANT_INVALID",
    "Workflow query image grant is invalid",
    400,
    cause === undefined ? undefined : { cause },
  );
}

export function hasQueryInput(input: {
  readonly query?: string | undefined;
  readonly queryImages?: readonly QueryImageReference[] | undefined;
}): boolean {
  return Boolean(input.query?.trim()) || (input.queryImages?.length ?? 0) > 0;
}

export function queryImageMetadata(image: ResolvedQueryImage): QueryImageMetadata {
  return {
    byteSize: image.byteSize,
    mimeType: image.mimeType,
    sha256: image.sha256,
    uploadFileId: image.uploadFileId,
  };
}

export function queryImageReferencesFromMetadata(
  metadata: Readonly<Record<string, JobPayload>>,
): readonly QueryImageReference[] {
  const parsed = QueryImageReferencesSchema.safeParse(
    metadata[QUERY_IMAGE_REFERENCES_METADATA_KEY],
  );
  return parsed.success ? parsed.data : [];
}

export function queryImageExpansionFromMetadata(
  metadata: Readonly<Record<string, JobPayload>>,
): string | undefined {
  const value = metadata[QUERY_IMAGE_EXPANSION_METADATA_KEY];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function assertResolvedQueryImages(
  images: readonly ResolvedQueryImage[],
): readonly ResolvedQueryImage[] {
  if (images.length > QUERY_IMAGE_MAX_COUNT) {
    throw new QueryImageResolutionError(
      "QUERY_IMAGE_COUNT_EXCEEDED",
      `queryImages exceeds max count ${QUERY_IMAGE_MAX_COUNT}`,
      413,
    );
  }

  let totalBytes = 0;
  for (const image of images) {
    QueryImageMimeTypeSchema.parse(image.mimeType);
    if (image.byteSize !== image.body.byteLength || image.byteSize < 1) {
      throw new QueryImageResolutionError(
        "QUERY_IMAGE_SIZE_INVALID",
        "Resolved query image byte size is invalid",
        400,
      );
    }
    if (image.byteSize > QUERY_IMAGE_MAX_BYTES) {
      throw new QueryImageResolutionError(
        "QUERY_IMAGE_TOO_LARGE",
        `Query image exceeds max bytes ${QUERY_IMAGE_MAX_BYTES}`,
        413,
      );
    }
    totalBytes += image.byteSize;
  }

  if (totalBytes > QUERY_IMAGE_MAX_TOTAL_BYTES) {
    throw new QueryImageResolutionError(
      "QUERY_IMAGE_TOTAL_TOO_LARGE",
      `Query images exceed aggregate max bytes ${QUERY_IMAGE_MAX_TOTAL_BYTES}`,
      413,
    );
  }

  return images;
}
