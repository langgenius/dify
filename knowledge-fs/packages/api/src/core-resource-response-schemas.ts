import "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import {
  AnswerTraceSchema,
  type FailedQuery,
  FailedQuerySchema,
  GoldenQuestionSchema,
  KnowledgeFsGcDryRunReportSchema,
  KnowledgeFsLeaseSchema,
  KnowledgeFsckReportSchema,
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceManifestSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  KnowledgeSpaceSchema,
  KnowledgeSpaceStagedCommitSchema,
  ParseArtifactSchema,
  type Source,
  SourceSchema,
} from "@knowledge/core";

export const FailedQueryResponseSchema = FailedQuerySchema.omit({
  answerTraceId: true,
}).openapi("FailedQuery");
export type FailedQueryResponse = z.infer<typeof FailedQueryResponseSchema>;

/** `answerTraceId` is an internal correlation key, never an editor-facing trace capability. */
export function toFailedQueryResponse(query: FailedQuery): FailedQueryResponse {
  const { answerTraceId: _answerTraceId, ...response } = query;
  return FailedQueryResponseSchema.parse(response);
}
export const GoldenQuestionResponseSchema = GoldenQuestionSchema.openapi("GoldenQuestion");
export const KnowledgeSpaceManifestResponseSchema =
  KnowledgeSpaceManifestSchema.openapi("KnowledgeSpaceManifest");
export const KnowledgeSpaceEmbeddingProfileResponseSchema =
  KnowledgeSpaceEmbeddingProfileSchema.openapi("KnowledgeSpaceEmbeddingProfile");
export const KnowledgeSpaceRetrievalProfileResponseSchema =
  KnowledgeSpaceRetrievalProfileSchema.openapi("KnowledgeSpaceRetrievalProfile");
export const KnowledgeSpacePendingModelConfigurationResponseSchema = z
  .object({
    configurationStatus: z.enum(["pending-validation", "setup-required"]),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.literal("initial-validation-pending"),
    revision: z.number().int().positive(),
  })
  .strict()
  .openapi("KnowledgeSpacePendingModelConfiguration");
export const KnowledgeSpaceResponseSchema = KnowledgeSpaceSchema.openapi("KnowledgeSpace");
export const KnowledgeSpaceCreationResponseSchema = KnowledgeSpaceSchema.extend({
  configurationStatus: z.enum([
    "pending-validation",
    "ready",
    "setup-required",
    "validation-failed",
  ]),
}).openapi("KnowledgeSpaceCreationResponse");
export const SourceResponseSchema = SourceSchema.omit({ credentialRef: true })
  .extend({
    credentialConfigured: z
      .boolean()
      .optional()
      .describe("True when credentials exist; the opaque SecretStore reference is never exposed"),
    metadata: z
      .record(z.unknown())
      .describe("Source metadata with credentials and other secret-bearing fields removed"),
  })
  .openapi("Source");

export type SourceResponse = z.infer<typeof SourceResponseSchema>;

const sensitiveSourceMetadataKey =
  /(?:credentials?|apikey|token|secret|secretkey|clientsecret|password|passwd|passphrase|privatekey|signingkey|pwd)$/u;
const sensitiveSourceMetadataExactKeys = new Set([
  "authorization",
  "authorizationheader",
  "cookie",
  "proxyauthorization",
  "setcookie",
]);

/**
 * Builds the public Source representation without mutating the repository-owned metadata.
 *
 * Connector credentials intentionally remain available inside the service. Only values crossing
 * the HTTP response boundary are recursively copied and stripped. Matching normalized key names
 * also covers common spellings such as `api_key`, `access-token`, `clientSecret`, and
 * `integration_password` while preserving operational fields such as `tokenCount`.
 */
export function toSourceResponse(source: Source): SourceResponse {
  return SourceResponseSchema.parse({
    ...source,
    ...(source.credentialRef || isSourceMetadataRecord(source.metadata.credentials)
      ? { credentialConfigured: true }
      : {}),
    credentialRef: undefined,
    metadata: redactSourceMetadata(source.metadata),
  });
}

export function redactSourceMetadata(
  metadata: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return redactSourceMetadataRecord(metadata);
}

/**
 * Applies a general-purpose metadata PATCH without allowing that endpoint to rotate credentials.
 * Omitted ordinary fields are retained, supplied ordinary objects are merged recursively, and
 * ordinary arrays are replaced. When an existing array contains a sensitive path, its entries are
 * merged by index and its existing length is retained so a redacted round-trip cannot drop a
 * credential-bearing element. Sensitive values supplied by the caller are always ignored.
 */
export function mergeSourceMetadataPatch(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return mergeSourceMetadataRecords(existing, patch);
}

function redactSourceMetadataRecord(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (isSensitiveSourceMetadataKey(key)) {
      continue;
    }

    redacted[key] = redactSourceMetadataValue(nestedValue);
  }

  return redacted;
}

function redactSourceMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSourceMetadataValue(item));
  }

  if (value !== null && typeof value === "object") {
    return redactSourceMetadataRecord(value as Readonly<Record<string, unknown>>);
  }

  return value;
}

function mergeSourceMetadataRecords(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged = new Map<string, unknown>(
    Object.entries(existing).map(([key, value]) => [key, cloneSourceMetadataValue(value)]),
  );

  for (const [key, patchValue] of Object.entries(patch)) {
    if (isSensitiveSourceMetadataKey(key)) {
      continue;
    }

    merged.set(
      key,
      Object.hasOwn(existing, key)
        ? mergeSourceMetadataValue(existing[key], patchValue)
        : redactSourceMetadataValue(patchValue),
    );
  }

  return Object.fromEntries(merged);
}

function mergeSourceMetadataValue(existing: unknown, patch: unknown): unknown {
  if (isSourceMetadataRecord(existing) && isSourceMetadataRecord(patch)) {
    return mergeSourceMetadataRecords(existing, patch);
  }

  if (Array.isArray(existing) && Array.isArray(patch)) {
    if (!containsSensitiveSourceMetadata(existing)) {
      return patch.map((value) => redactSourceMetadataValue(value));
    }

    const merged: unknown[] = [];
    const length = Math.max(existing.length, patch.length);

    for (let index = 0; index < length; index += 1) {
      if (index >= patch.length) {
        merged.push(cloneSourceMetadataValue(existing[index]));
      } else if (index >= existing.length) {
        merged.push(redactSourceMetadataValue(patch[index]));
      } else {
        merged.push(mergeSourceMetadataValue(existing[index], patch[index]));
      }
    }

    return merged;
  }

  // Replacing a credential-bearing container with a scalar or a different container shape would
  // silently delete its secrets. Keep it intact until a dedicated credential endpoint exists.
  if (containsSensitiveSourceMetadata(existing)) {
    return cloneSourceMetadataValue(existing);
  }

  return redactSourceMetadataValue(patch);
}

function cloneSourceMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneSourceMetadataValue(item));
  }

  if (isSourceMetadataRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneSourceMetadataValue(nestedValue),
      ]),
    );
  }

  return value;
}

function containsSensitiveSourceMetadata(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveSourceMetadata(item));
  }

  if (!isSourceMetadataRecord(value)) {
    return false;
  }

  return Object.entries(value).some(
    ([key, nestedValue]) =>
      isSensitiveSourceMetadataKey(key) || containsSensitiveSourceMetadata(nestedValue),
  );
}

function isSourceMetadataRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveSourceMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    sensitiveSourceMetadataExactKeys.has(normalized) || sensitiveSourceMetadataKey.test(normalized)
  );
}
export const KnowledgeSpaceStagedCommitResponseSchema = KnowledgeSpaceStagedCommitSchema.openapi(
  "KnowledgeSpaceStagedCommit",
);
export const KnowledgeFsLeaseResponseSchema = KnowledgeFsLeaseSchema.openapi("KnowledgeFsLease");
export const ParseArtifactResponseSchema = ParseArtifactSchema.openapi("ParseArtifact");
export const AnswerTraceResponseSchema = AnswerTraceSchema.omit({
  permissionSnapshot: true,
  subjectId: true,
}).openapi("AnswerTrace");
export const KnowledgeFsckReportResponseSchema =
  KnowledgeFsckReportSchema.openapi("KnowledgeFsckReport");
export const KnowledgeFsGcDryRunReportResponseSchema = KnowledgeFsGcDryRunReportSchema.openapi(
  "KnowledgeFsGcDryRunReport",
);

export const KnowledgeFsStagedObjectGcExecuteResponseSchema = z
  .object({
    deleted: z.number().int().nonnegative(),
    items: z.array(
      z.object({
        idempotencyKey: z.string(),
        objectKey: z.string(),
        status: z.enum(["deleted", "skipped-active-lease"]),
      }),
    ),
    skipped: z.number().int().nonnegative(),
    tenantId: z.string(),
  })
  .openapi("KnowledgeFsStagedObjectGcExecuteResult");

const KnowledgeSpaceStatusCountedListSchema = <Item extends z.ZodTypeAny>(item: Item) =>
  z.object({
    count: z.number().int().nonnegative(),
    items: z.array(item),
    truncated: z.boolean(),
  });

export const KnowledgeSpaceStatusProjectionSummarySchema = z.object({
  building: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

const KnowledgeSpaceConfigurationStatusSchema = z.enum([
  "setup-required",
  "pending-validation",
  "validation-failed",
  "ready",
]);

const KnowledgeSpacePendingModelConfigurationStatusShape = {
  digest: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
  revision: z.number().int().positive(),
} as const;

const KnowledgeSpacePendingModelConfigurationStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...KnowledgeSpacePendingModelConfigurationStatusShape,
      state: z.literal("pending-validation"),
    })
    .strict(),
  z
    .object({
      ...KnowledgeSpacePendingModelConfigurationStatusShape,
      failure: z
        .object({
          code: z.string().trim().min(1).max(64),
          failedAt: z.string().datetime(),
          retryable: z.boolean(),
        })
        .strict(),
      state: z.literal("validation-failed"),
    })
    .strict(),
]);

export const KnowledgeSpaceConfigurationStatusResponseSchema = z
  .object({
    activeProfiles: z
      .object({
        embeddingRevision: z.number().int().positive().optional(),
        retrievalRevision: z.number().int().positive().optional(),
      })
      .strict(),
    availableModes: z.array(z.enum(["fast", "research", "deep"])),
    pendingModelConfiguration: KnowledgeSpacePendingModelConfigurationStatusSchema.optional(),
    status: KnowledgeSpaceConfigurationStatusSchema,
  })
  .strict();

export const KnowledgeSpaceStatusResponseSchema = z
  .object({
    activeLeases: KnowledgeSpaceStatusCountedListSchema(
      z.object({
        expiresAt: z.string().datetime(),
        id: z.string().uuid(),
        leaseType: z.enum(["read", "publish", "delete", "reindex"]),
        targetType: z.enum([
          "knowledge-space",
          "document-asset",
          "parse-artifact",
          "knowledge-path",
          "projection",
          "staged-commit",
        ]),
        virtualPath: z.string(),
      }),
    ),
    activeSessions: KnowledgeSpaceStatusCountedListSchema(
      z.object({
        clientKind: z.enum(["api", "mcp", "worker", "admin"]),
        consistencyClass: z.enum([
          "path-consistent",
          "snapshot-consistent",
          "cache-consistent",
          "eventual-preview",
        ]),
        expiresAt: z.string().datetime(),
        heartbeatAt: z.string().datetime(),
        id: z.string().uuid(),
        subjectId: z.string(),
      }),
    ),
    configuration: KnowledgeSpaceConfigurationStatusResponseSchema,
    failedCommits: KnowledgeSpaceStatusCountedListSchema(
      z.object({
        errorCode: z.string().optional(),
        expiresAt: z.string().datetime().optional(),
        id: z.string().uuid(),
        status: z.enum(["failed-retryable", "failed-terminal"]),
        updatedAt: z.string().datetime(),
      }),
    ),
    generatedAt: z.string().datetime(),
    index: z.object({
      nodeSchemaVersion: z.number().int().positive(),
      projectionSetVersion: z.string(),
      projectionVersion: z.number().int().positive(),
      summaries: z.object({
        denseVector: KnowledgeSpaceStatusProjectionSummarySchema,
        fts: KnowledgeSpaceStatusProjectionSummarySchema,
        graph: KnowledgeSpaceStatusProjectionSummarySchema,
        metadata: KnowledgeSpaceStatusProjectionSummarySchema,
      }),
    }),
    knowledgeSpaceId: z.string().uuid(),
    manifest: z.object({
      consistencyClass: z.enum([
        "path-consistent",
        "snapshot-consistent",
        "cache-consistent",
        "eventual-preview",
      ]),
      manifestVersion: z.number().int().positive(),
      metadataDialect: z.enum(["portable", "postgres", "tidb"]),
      objectKeyPrefix: z.string(),
      storageProvider: z.enum(["memory-dev", "r2", "s3-compatible"]),
    }),
    parser: z.object({
      kind: z.enum(["native-html", "native-markdown", "native-structured", "unstructured"]),
      policyVersion: z.string(),
    }),
    storage: z.object({
      healthy: z.boolean(),
      objectStorageKind: z.enum(["r2", "s3-compatible", "local", "memory"]),
      provider: z.enum(["memory-dev", "r2", "s3-compatible"]),
    }),
    tenantId: z.string(),
  })
  .openapi("KnowledgeSpaceStatus");

export const KnowledgeSpaceStatsResponseSchema = z
  .object({
    cache: z.object({
      available: z.boolean(),
      entries: z.number().int().nonnegative(),
      totalBytes: z.number().int().nonnegative(),
    }),
    commits: z.object({
      failedRetryable: z.number().int().nonnegative(),
      failedTerminal: z.number().int().nonnegative(),
      sampled: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
    generatedAt: z.string().datetime(),
    knowledgeSpaceId: z.string().uuid(),
    metrics: z.object({
      available: z.boolean(),
      reason: z.string().optional(),
    }),
    projections: z.object({
      denseVector: KnowledgeSpaceStatusProjectionSummarySchema,
      fts: KnowledgeSpaceStatusProjectionSummarySchema,
      graph: KnowledgeSpaceStatusProjectionSummarySchema,
      metadata: KnowledgeSpaceStatusProjectionSummarySchema,
      projectionVersion: z.number().int().positive(),
    }),
    runtime: z.object({
      activeLeaseSampleCount: z.number().int().nonnegative(),
      activeSessionSampleCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
    storage: z.object({
      documentCount: z.number().int().nonnegative(),
      rawDocumentBytes: z.number().int().nonnegative(),
    }),
    tenantId: z.string(),
    window: z.object({
      end: z.string().datetime(),
      minutes: z.number().int().positive().max(1440),
      start: z.string().datetime(),
    }),
  })
  .openapi("KnowledgeSpaceStats");
