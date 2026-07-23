import { z } from "zod";

import { stableJson } from "./json-utils";

export const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/**
 * Reserved only for mapping legacy NULL publication generations into generation-aware unique
 * indexes. It must never identify an actual immutable publication build.
 */
export const PUBLICATION_GENERATION_ID_SENTINEL = "00000000-0000-0000-0000-000000000000";
export const PublicationGenerationIdSchema = UuidSchema.transform((value) =>
  value.toLowerCase(),
).refine(
  (value) => value.toLowerCase() !== PUBLICATION_GENERATION_ID_SENTINEL,
  "Publication generation ID must be a non-zero UUID",
);
export type PublicationGenerationId = z.infer<typeof PublicationGenerationIdSchema>;
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/i);
export const DateTimeSchema = z.string().datetime();
const MetadataSchema = z.record(z.unknown()).default({});
const PermissionScopeSchema = z.array(z.string().min(1)).default([]);
const KnowledgeFsNamespaceValues = ["sources", "knowledge", "evidence", "workspaces"] as const;
export const TenantIdSchema = z.string().min(1).max(255);

export const AuthSubjectSchema = z.object({
  scopes: z.array(z.string().min(1)).default([]),
  subjectId: z.string().min(1),
  tenantId: TenantIdSchema,
});
export type AuthSubject = z.infer<typeof AuthSubjectSchema>;

export const KnowledgeSpaceSchema = z.object({
  createdAt: DateTimeSchema,
  description: z.string().max(2000).optional(),
  iconRef: z
    .string()
    .max(72)
    .regex(/^builtin:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
    .optional(),
  id: UuidSchema,
  name: z.string().min(1).max(160),
  revision: z.number().int().positive(),
  slug: z
    .string()
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  tenantId: TenantIdSchema,
  updatedAt: DateTimeSchema,
});
export type KnowledgeSpace = z.infer<typeof KnowledgeSpaceSchema>;

// Non-Dify values remain readable only for legacy manifests during coexistence. New manifests
// always use `dify`, and the production adapter has no direct provider implementation.
export const KnowledgeSpaceStorageProviderSchema = z.enum([
  "dify",
  "memory-dev",
  "r2",
  "s3-compatible",
]);
export type KnowledgeSpaceStorageProvider = z.infer<typeof KnowledgeSpaceStorageProviderSchema>;

export const KnowledgeSpaceMetadataDialectSchema = z.enum(["portable", "postgres", "tidb"]);
export type KnowledgeSpaceMetadataDialect = z.infer<typeof KnowledgeSpaceMetadataDialectSchema>;

export const KnowledgeSpaceConsistencyClassSchema = z.enum([
  "path-consistent",
  "snapshot-consistent",
  "cache-consistent",
  "eventual-preview",
]);
export type KnowledgeSpaceConsistencyClass = z.infer<typeof KnowledgeSpaceConsistencyClassSchema>;

export const KnowledgeFsSessionClientKindSchema = z.enum(["api", "mcp", "worker", "admin"]);
export type KnowledgeFsSessionClientKind = z.infer<typeof KnowledgeFsSessionClientKindSchema>;

export const KnowledgeFsSessionSchema = z.object({
  clientKind: KnowledgeFsSessionClientKindSchema,
  clientVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  consistencyClass: KnowledgeSpaceConsistencyClassSchema,
  createdAt: DateTimeSchema,
  expiresAt: DateTimeSchema,
  heartbeatAt: DateTimeSchema,
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  permissionSnapshot: PermissionScopeSchema,
  subject: AuthSubjectSchema,
  tenantId: TenantIdSchema,
  updatedAt: DateTimeSchema,
});
export type KnowledgeFsSession = z.infer<typeof KnowledgeFsSessionSchema>;

export const KnowledgeFsLeaseTypeSchema = z.enum(["read", "publish", "delete", "reindex"]);
export type KnowledgeFsLeaseType = z.infer<typeof KnowledgeFsLeaseTypeSchema>;

export const KnowledgeFsLeaseTargetTypeSchema = z.enum([
  "knowledge-space",
  "document-asset",
  "parse-artifact",
  "knowledge-path",
  "projection",
  "staged-commit",
]);
export type KnowledgeFsLeaseTargetType = z.infer<typeof KnowledgeFsLeaseTargetTypeSchema>;

export const KnowledgeFsLeaseStatusSchema = z.enum(["active", "released", "expired", "failed"]);
export type KnowledgeFsLeaseStatus = z.infer<typeof KnowledgeFsLeaseStatusSchema>;

const KnowledgeFsLeaseVirtualPathSchema = z
  .string()
  .max(384)
  .regex(new RegExp(`^/(?:${KnowledgeFsNamespaceValues.join("|")})(?:/[^/\\s]+)*$`));

export const KnowledgeFsLeaseSchema = z.object({
  acquiredAt: DateTimeSchema,
  expiresAt: DateTimeSchema,
  heartbeatAt: DateTimeSchema,
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  leaseType: KnowledgeFsLeaseTypeSchema,
  metadata: MetadataSchema,
  sessionId: UuidSchema,
  status: KnowledgeFsLeaseStatusSchema,
  targetId: z.string().min(1).max(512),
  targetType: KnowledgeFsLeaseTargetTypeSchema,
  targetVersion: z.number().int().positive().optional(),
  tenantId: TenantIdSchema,
  updatedAt: DateTimeSchema,
  virtualPath: KnowledgeFsLeaseVirtualPathSchema,
});
export type KnowledgeFsLease = z.infer<typeof KnowledgeFsLeaseSchema>;

export const KnowledgeFsckIssueSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export type KnowledgeFsckIssueSeverity = z.infer<typeof KnowledgeFsckIssueSeveritySchema>;

export const KnowledgeFsckIssueTypeSchema = z.enum([
  "missing-raw-object",
  "checksum-mismatch",
  "size-mismatch",
  "missing-artifact-object",
  "segment-hash-mismatch",
  "broken-path-target",
  "missing-node-target",
  "stale-projection",
  "orphaned-staged-object",
  "failed-commit-expired",
]);
export type KnowledgeFsckIssueType = z.infer<typeof KnowledgeFsckIssueTypeSchema>;

export const KnowledgeFsckRepairabilitySchema = z.enum([
  "auto-repairable",
  "manual",
  "not-repairable",
]);
export type KnowledgeFsckRepairability = z.infer<typeof KnowledgeFsckRepairabilitySchema>;

export const KnowledgeFsckTargetTypeSchema = z.enum([
  "raw-object",
  "artifact-object",
  "artifact-segment",
  "knowledge-path",
  "knowledge-node",
  "index-projection",
  "staged-commit",
]);
export type KnowledgeFsckTargetType = z.infer<typeof KnowledgeFsckTargetTypeSchema>;

export const KnowledgeFsckTargetSchema = z.object({
  documentAssetId: UuidSchema.optional(),
  id: z.string().min(1).max(512).optional(),
  objectKey: z.string().min(1).max(1024).optional(),
  parseArtifactId: UuidSchema.optional(),
  type: KnowledgeFsckTargetTypeSchema,
  virtualPath: KnowledgeFsLeaseVirtualPathSchema.optional(),
});
export type KnowledgeFsckTarget = z.infer<typeof KnowledgeFsckTargetSchema>;

export const KnowledgeFsckIssueSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(1_000),
  repairability: KnowledgeFsckRepairabilitySchema,
  severity: KnowledgeFsckIssueSeveritySchema,
  target: KnowledgeFsckTargetSchema,
  type: KnowledgeFsckIssueTypeSchema,
});
export type KnowledgeFsckIssue = z.infer<typeof KnowledgeFsckIssueSchema>;

export const KnowledgeFsckSummarySchema = z.object({
  critical: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  repairable: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
});
export type KnowledgeFsckSummary = z.infer<typeof KnowledgeFsckSummarySchema>;

export const KnowledgeFsckReportSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  issues: z.array(KnowledgeFsckIssueSchema).max(1_000),
  knowledgeSpaceId: UuidSchema,
  scannedAt: DateTimeSchema,
  summary: KnowledgeFsckSummarySchema,
  tenantId: TenantIdSchema,
});
export type KnowledgeFsckReport = z.infer<typeof KnowledgeFsckReportSchema>;

export const KnowledgeFsGcCandidateTypeSchema = z.enum([
  "staged-object",
  "failed-commit",
  "artifact-segment",
  "parse-artifact",
  "index-projection",
  "answer-trace",
]);
export type KnowledgeFsGcCandidateType = z.infer<typeof KnowledgeFsGcCandidateTypeSchema>;

export const KnowledgeFsGcCandidateSchema = z.object({
  candidateType: KnowledgeFsGcCandidateTypeSchema,
  count: z.number().int().positive(),
  estimatedBytes: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(512),
  reason: z.string().min(1).max(1_000),
  target: KnowledgeFsckTargetSchema,
});
export type KnowledgeFsGcCandidate = z.infer<typeof KnowledgeFsGcCandidateSchema>;

export const KnowledgeFsGcDryRunSummarySchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  estimatedBytes: z.number().int().nonnegative(),
  failedCommitCount: z.number().int().nonnegative(),
  stagedObjectCount: z.number().int().nonnegative(),
});
export type KnowledgeFsGcDryRunSummary = z.infer<typeof KnowledgeFsGcDryRunSummarySchema>;

export const KnowledgeFsGcDryRunReportSchema = z.object({
  candidates: z.array(KnowledgeFsGcCandidateSchema).max(1_000),
  cursor: z.string().min(1).max(1024).optional(),
  dryRunId: z.string().min(1).max(128),
  generatedAt: DateTimeSchema,
  knowledgeSpaceId: UuidSchema,
  summary: KnowledgeFsGcDryRunSummarySchema,
  tenantId: TenantIdSchema,
});
export type KnowledgeFsGcDryRunReport = z.infer<typeof KnowledgeFsGcDryRunReportSchema>;

export const KnowledgeSpaceObjectKeyPrefixSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._=-]+(?:\/[A-Za-z0-9._=-]+)*$/)
  .refine((prefix) => !prefix.split("/").includes(".."), {
    message: "Object key prefix must not contain parent directory segments",
  });

const NullablePositiveIntegerSchema = z.number().int().positive().nullable();
const QuotaLimitSchema = NullablePositiveIntegerSchema.default(null);

export const KnowledgeSpaceProviderBudgetPolicySchema = z
  .object({
    maxEmbeddingTokensPerDay: QuotaLimitSchema,
    maxLlmTokensPerDay: QuotaLimitSchema,
    maxParserPagesPerDay: QuotaLimitSchema,
    maxRerankRequestsPerDay: QuotaLimitSchema,
  })
  .default({});
export type KnowledgeSpaceProviderBudgetPolicy = z.infer<
  typeof KnowledgeSpaceProviderBudgetPolicySchema
>;

export const KnowledgeSpaceQuotaPolicySchema = z.object({
  maxActiveJobCount: QuotaLimitSchema,
  maxActiveSessionCount: QuotaLimitSchema,
  maxArtifactBytes: QuotaLimitSchema,
  maxGraphEntityCount: QuotaLimitSchema,
  maxGraphRelationCount: QuotaLimitSchema,
  maxNodeCount: QuotaLimitSchema,
  maxProjectionCount: QuotaLimitSchema,
  maxRawDocumentBytes: QuotaLimitSchema,
  maxSegmentCount: QuotaLimitSchema,
  maxTraceBytes: QuotaLimitSchema,
  providerBudgets: KnowledgeSpaceProviderBudgetPolicySchema,
});
export type KnowledgeSpaceQuotaPolicy = z.infer<typeof KnowledgeSpaceQuotaPolicySchema>;

const EmbeddingProfileIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;

        return codePoint >= 32 && codePoint !== 127;
      }),
    {
      message: "Embedding profile identifiers must not contain control characters",
    },
  );

/**
 * User-selectable embedding routing fields. Runtime credentials and vector dimensions are
 * intentionally excluded: credentials stay in the plugin daemon and dimensions are observed from
 * an actual embedding response.
 */
export const KnowledgeSpaceModelSelectionSchema = z
  .object({
    model: EmbeddingProfileIdentifierSchema,
    pluginId: EmbeddingProfileIdentifierSchema,
    provider: EmbeddingProfileIdentifierSchema,
  })
  .strict();
export type KnowledgeSpaceModelSelection = z.infer<typeof KnowledgeSpaceModelSelectionSchema>;

export const KnowledgeSpaceEmbeddingSelectionSchema = KnowledgeSpaceModelSelectionSchema;
export type KnowledgeSpaceEmbeddingSelection = z.infer<
  typeof KnowledgeSpaceEmbeddingSelectionSchema
>;

export const KnowledgeSpaceEmbeddingProfileSchema = KnowledgeSpaceEmbeddingSelectionSchema.extend({
  dimension: z.number().int().positive().optional(),
  revision: z.number().int().positive(),
  vectorSpaceId: z.string().regex(/^embedding-space-sha256:[a-f0-9]{64}$/),
}).strict();
export type KnowledgeSpaceEmbeddingProfile = z.infer<typeof KnowledgeSpaceEmbeddingProfileSchema>;

/**
 * Immutable daemon-install identity used when deriving a vector space. The routing selection is
 * intentionally small and user-facing; this snapshot prevents an in-place plugin upgrade or
 * schema change from silently reusing vectors built with different semantics.
 */
export const KnowledgeSpaceVectorSpaceIdentitySchema = z
  .object({
    capabilityDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    dimension: z.number().int().positive(),
    distanceMetric: z.enum(["cosine", "dot", "l2"]),
    pluginUniqueIdentifier: z.string().trim().min(1).max(1024),
    schemaFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type KnowledgeSpaceVectorSpaceIdentity = z.infer<
  typeof KnowledgeSpaceVectorSpaceIdentitySchema
>;

export const KnowledgeSpaceRetrievalModeSchema = z.enum(["fast", "research", "deep"]);
export type KnowledgeSpaceRetrievalMode = z.infer<typeof KnowledgeSpaceRetrievalModeSchema>;

const KnowledgeSpaceRetrievalProfileShape = {
  defaultMode: KnowledgeSpaceRetrievalModeSchema,
  reasoningModel: KnowledgeSpaceModelSelectionSchema,
  rerank: z
    .object({
      enabled: z.boolean(),
      model: KnowledgeSpaceModelSelectionSchema.optional(),
    })
    .strict(),
  scoreThreshold: z
    .object({
      enabled: z.boolean(),
      /**
       * `rerank` is the persisted legacy spelling. Both values now mean the
       * mode-final comparable score: rerank for Fast/Deep and PageIndex for
       * Research.
       */
      stage: z.enum(["mode-final", "rerank"]),
      value: z.number().min(0).max(1).optional(),
    })
    .strict(),
  topK: z.number().int().min(1).max(100),
} as const;

export const KnowledgeSpaceRetrievalProfileInputSchema = z
  .object(KnowledgeSpaceRetrievalProfileShape)
  .strict()
  .superRefine(validateKnowledgeSpaceRetrievalProfile);
export type KnowledgeSpaceRetrievalProfileInput = z.infer<
  typeof KnowledgeSpaceRetrievalProfileInputSchema
>;

/**
 * User-selected model configuration that has not crossed the plugin-daemon capability boundary yet.
 * Empty knowledge spaces persist this intent without inventing an embedding dimension, vector-space
 * identity, or verified capability snapshot. The first durable document compilation validates and
 * replaces it with immutable active profile revisions.
 */
export const KnowledgeSpacePendingModelConfigurationSchema = z
  .object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    embeddingSelection: KnowledgeSpaceEmbeddingSelectionSchema.optional(),
    failure: z
      .object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._:-]{1,64}$/),
        failedAt: DateTimeSchema,
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
    retrievalProfile: KnowledgeSpaceRetrievalProfileInputSchema.optional(),
    revision: z.number().int().positive(),
    state: z.enum(["pending-validation", "validation-failed"]),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (!configuration.embeddingSelection && !configuration.retrievalProfile) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A pending model configuration must contain at least one model selection",
        path: ["retrievalProfile"],
      });
    }
    if (
      configuration.retrievalProfile &&
      configuration.retrievalProfile.defaultMode !== "research" &&
      !configuration.embeddingSelection
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fast/Deep pending model configuration requires an embedding selection",
        path: ["embeddingSelection"],
      });
    }
    if (configuration.state === "pending-validation" && configuration.failure) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pending model validation must not contain a failure",
        path: ["failure"],
      });
    }
    if (configuration.state === "validation-failed" && !configuration.failure) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Failed model validation requires failure metadata",
        path: ["failure"],
      });
    }
  });
export type KnowledgeSpacePendingModelConfiguration = z.infer<
  typeof KnowledgeSpacePendingModelConfigurationSchema
>;

export const KnowledgeSpaceRetrievalProfileSchema = z
  .object({
    ...KnowledgeSpaceRetrievalProfileShape,
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateKnowledgeSpaceRetrievalProfile)
  .superRefine(validatePersistedKnowledgeSpaceRetrievalProfileMode);
export type KnowledgeSpaceRetrievalProfile = z.infer<typeof KnowledgeSpaceRetrievalProfileSchema>;

export const KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE =
  "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK";
export const KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE =
  "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled";

interface KnowledgeSpaceRetrievalProfileModeFields {
  readonly rerank: { readonly enabled: boolean };
  readonly scoreThreshold: { readonly enabled: boolean };
}

export interface KnowledgeSpaceRetrievalProfileModeValidationError {
  readonly code: typeof KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE;
  readonly message: typeof KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE;
  readonly mode: KnowledgeSpaceRetrievalMode;
}

export class KnowledgeSpaceRetrievalProfileModeError extends Error {
  readonly code = KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE;
  readonly mode: KnowledgeSpaceRetrievalMode;

  constructor(mode: KnowledgeSpaceRetrievalMode) {
    super(KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE);
    this.name = "KnowledgeSpaceRetrievalProfileModeError";
    this.mode = mode;
  }
}

function validateKnowledgeSpaceRetrievalProfile(
  profile: {
    readonly rerank: { readonly enabled: boolean; readonly model?: unknown | undefined };
    readonly scoreThreshold: {
      readonly enabled: boolean;
      readonly value?: number | undefined;
    };
  },
  context: z.RefinementCtx,
): void {
  if (profile.rerank.enabled && !profile.rerank.model) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled rerank requires a model selection",
      path: ["rerank", "model"],
    });
  }

  if (profile.scoreThreshold.enabled && profile.scoreThreshold.value === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enabled score threshold requires a value",
      path: ["scoreThreshold", "value"],
    });
  }
}

function validatePersistedKnowledgeSpaceRetrievalProfileMode(
  profile: KnowledgeSpaceRetrievalProfileModeFields & {
    readonly defaultMode: KnowledgeSpaceRetrievalMode;
  },
  context: z.RefinementCtx,
): void {
  const validationError = validateKnowledgeSpaceRetrievalProfileForMode(
    profile,
    profile.defaultMode,
  );
  if (validationError) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: validationError.message,
      path: ["scoreThreshold"],
    });
  }
}

/**
 * Validates the mode-dependent threshold contract. Research thresholds are applied to PageIndex
 * scores and therefore do not require reranking; Fast and Deep thresholds are applied after the
 * shared final rerank pass and cannot be evaluated when reranking is disabled.
 */
export function validateKnowledgeSpaceRetrievalProfileForMode(
  profile: KnowledgeSpaceRetrievalProfileModeFields,
  mode: KnowledgeSpaceRetrievalMode,
): KnowledgeSpaceRetrievalProfileModeValidationError | undefined {
  const parsedMode = KnowledgeSpaceRetrievalModeSchema.parse(mode);
  if (parsedMode !== "research" && profile.scoreThreshold.enabled && !profile.rerank.enabled) {
    return {
      code: KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_CODE,
      message: KNOWLEDGE_SPACE_RETRIEVAL_PROFILE_MODE_ERROR_MESSAGE,
      mode: parsedMode,
    };
  }

  return undefined;
}

export function assertKnowledgeSpaceRetrievalProfileForMode(
  profile: KnowledgeSpaceRetrievalProfileModeFields,
  mode: KnowledgeSpaceRetrievalMode,
): void {
  const validationError = validateKnowledgeSpaceRetrievalProfileForMode(profile, mode);
  if (validationError) {
    throw new KnowledgeSpaceRetrievalProfileModeError(validationError.mode);
  }
}

export function createKnowledgeSpaceRetrievalProfile(
  input: KnowledgeSpaceRetrievalProfileInput,
  revision = 1,
): KnowledgeSpaceRetrievalProfile {
  const parsedInput = KnowledgeSpaceRetrievalProfileInputSchema.parse(input);
  assertKnowledgeSpaceRetrievalProfileForMode(parsedInput, parsedInput.defaultMode);
  return KnowledgeSpaceRetrievalProfileSchema.parse({
    ...parsedInput,
    revision,
  });
}

export async function buildKnowledgeSpaceVectorSpaceId(
  selection: KnowledgeSpaceEmbeddingSelection,
  revision: number,
  identity?: KnowledgeSpaceVectorSpaceIdentity,
): Promise<string> {
  const parsedSelection = KnowledgeSpaceEmbeddingSelectionSchema.parse(selection);
  const parsedRevision = z.number().int().positive().parse(revision);
  const parsedIdentity = identity
    ? KnowledgeSpaceVectorSpaceIdentitySchema.parse(identity)
    : undefined;
  const digest = await sha256Hex(
    stableJson({
      ...(parsedIdentity ? { installIdentity: parsedIdentity } : {}),
      model: parsedSelection.model,
      pluginId: parsedSelection.pluginId,
      provider: parsedSelection.provider,
      revision: parsedRevision,
      schemaVersion: parsedIdentity ? 2 : 1,
    }),
  );

  return `embedding-space-sha256:${digest}`;
}

export async function createKnowledgeSpaceEmbeddingProfile(
  selection: KnowledgeSpaceEmbeddingSelection,
  revision = 1,
  identity?: KnowledgeSpaceVectorSpaceIdentity,
): Promise<KnowledgeSpaceEmbeddingProfile> {
  const parsedSelection = KnowledgeSpaceEmbeddingSelectionSchema.parse(selection);

  return KnowledgeSpaceEmbeddingProfileSchema.parse({
    ...parsedSelection,
    revision,
    vectorSpaceId: await buildKnowledgeSpaceVectorSpaceId(parsedSelection, revision, identity),
  });
}

/** Returns the current profile for an unchanged selection, otherwise creates a new vector space. */
export async function updateKnowledgeSpaceEmbeddingProfile(
  current: KnowledgeSpaceEmbeddingProfile | undefined,
  selection: KnowledgeSpaceEmbeddingSelection,
  identity?: KnowledgeSpaceVectorSpaceIdentity,
): Promise<KnowledgeSpaceEmbeddingProfile> {
  const parsedSelection = KnowledgeSpaceEmbeddingSelectionSchema.parse(selection);
  const sameSelection =
    current &&
    current.pluginId === parsedSelection.pluginId &&
    current.provider === parsedSelection.provider &&
    current.model === parsedSelection.model;

  if (
    sameSelection &&
    (!identity ||
      current.vectorSpaceId ===
        (await buildKnowledgeSpaceVectorSpaceId(parsedSelection, current.revision, identity)))
  ) {
    return current;
  }

  return createKnowledgeSpaceEmbeddingProfile(
    parsedSelection,
    (current?.revision ?? 0) + 1,
    identity,
  );
}

export const KnowledgeSpaceManifestSchema = z.object({
  consistencyPolicy: z.object({
    cacheTtlSeconds: z.number().int().positive().optional(),
    defaultClass: KnowledgeSpaceConsistencyClassSchema,
    snapshotTtlSeconds: z.number().int().positive(),
  }),
  createdAt: DateTimeSchema,
  embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.optional(),
  /**
   * Server-owned, monotonic latch set before the first document asset is admitted. Once present,
   * changing the embedding selection requires an explicit reindex workflow rather than an inline
   * profile mutation.
   */
  embeddingProfileFrozenAt: DateTimeSchema.optional(),
  encryptionPolicy: z.object({
    keyRef: z.string().min(1).max(512).optional(),
    strategy: z.enum(["provider-managed", "customer-managed", "none"]),
  }),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  manifestVersion: z.number().int().positive(),
  metadata: MetadataSchema,
  metadataDialect: KnowledgeSpaceMetadataDialectSchema,
  minClientVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  nodeSchemaVersion: z.number().int().positive(),
  objectKeyPrefix: KnowledgeSpaceObjectKeyPrefixSchema,
  parserPolicyVersion: z.string().min(1).max(128),
  pendingModelConfiguration: KnowledgeSpacePendingModelConfigurationSchema.optional(),
  projectionSetVersion: z.string().min(1).max(128),
  quotaPolicy: KnowledgeSpaceQuotaPolicySchema,
  retentionPolicy: z.object({
    artifactVersionsToKeep: z.number().int().positive(),
    failedCommitRetentionDays: z.number().int().positive(),
    traceRetentionDays: z.number().int().positive(),
  }),
  retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.optional(),
  storageProvider: KnowledgeSpaceStorageProviderSchema,
  tenantId: TenantIdSchema,
  updatedAt: DateTimeSchema,
});
export type KnowledgeSpaceManifest = z.infer<typeof KnowledgeSpaceManifestSchema>;

export interface CreateDefaultKnowledgeSpaceManifestInput {
  readonly createdAt: string;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly pendingModelConfiguration?: KnowledgeSpacePendingModelConfiguration | undefined;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export function createDefaultKnowledgeSpaceManifest(
  input: CreateDefaultKnowledgeSpaceManifestInput,
): KnowledgeSpaceManifest {
  return KnowledgeSpaceManifestSchema.parse({
    consistencyPolicy: {
      defaultClass: "path-consistent",
      snapshotTtlSeconds: 3600,
    },
    createdAt: input.createdAt,
    ...(input.embeddingProfile ? { embeddingProfile: input.embeddingProfile } : {}),
    encryptionPolicy: {
      strategy: "provider-managed",
    },
    id: input.id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    manifestVersion: 1,
    metadata: {},
    metadataDialect: "portable",
    minClientVersion: "0.0.0",
    nodeSchemaVersion: 1,
    objectKeyPrefix: `${normalizeObjectKeyPrefixSegment(input.tenantId)}/spaces/${
      input.knowledgeSpaceId
    }`,
    parserPolicyVersion: "default-v1",
    ...(input.pendingModelConfiguration
      ? { pendingModelConfiguration: input.pendingModelConfiguration }
      : {}),
    projectionSetVersion: "default-v1",
    quotaPolicy: {
      maxActiveJobCount: null,
      maxActiveSessionCount: null,
      maxArtifactBytes: null,
      maxGraphEntityCount: null,
      maxGraphRelationCount: null,
      maxNodeCount: null,
      maxProjectionCount: null,
      maxRawDocumentBytes: null,
      maxSegmentCount: null,
      maxTraceBytes: null,
      providerBudgets: {
        maxEmbeddingTokensPerDay: null,
        maxLlmTokensPerDay: null,
        maxParserPagesPerDay: null,
        maxRerankRequestsPerDay: null,
      },
    },
    retentionPolicy: {
      artifactVersionsToKeep: 3,
      failedCommitRetentionDays: 14,
      traceRetentionDays: 30,
    },
    ...(input.retrievalProfile ? { retrievalProfile: input.retrievalProfile } : {}),
    storageProvider: "dify",
    tenantId: input.tenantId,
    updatedAt: input.updatedAt,
  });
}

function normalizeObjectKeyPrefixSegment(segment: string): string {
  const normalized = segment.replace(/[^A-Za-z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "");

  return normalized || "tenant";
}

export const KnowledgeSpaceStagedCommitOperationTypeSchema = z.enum([
  "document-upload",
  "artifact-segment-write",
  "bulk-reindex",
  "projection-publish",
]);
export type KnowledgeSpaceStagedCommitOperationType = z.infer<
  typeof KnowledgeSpaceStagedCommitOperationTypeSchema
>;

export const KnowledgeSpaceStagedCommitStatusSchema = z.enum([
  "received",
  "object-staged",
  "object-verified",
  "metadata-prepared",
  "artifacts-built",
  "nodes-built",
  "projections-built",
  "published",
  "failed-retryable",
  "failed-terminal",
  "canceled",
  "gc-pending",
  "gc-complete",
]);
export type KnowledgeSpaceStagedCommitStatus = z.infer<
  typeof KnowledgeSpaceStagedCommitStatusSchema
>;

const ObjectStorageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9._=-]+(?:\/[A-Za-z0-9._=-]+)*$/)
  .refine((key) => !key.split("/").includes(".."), {
    message: "Object storage key must not contain parent directory segments",
  });

export const KnowledgeSpaceStagedCommitSchema = z.object({
  checksum: Sha256Schema.optional(),
  createdAt: DateTimeSchema,
  documentAssetId: UuidSchema.optional(),
  errorCode: z.string().min(1).max(128).optional(),
  errorMessage: z.string().min(1).max(2000).optional(),
  expiresAt: DateTimeSchema.optional(),
  id: UuidSchema,
  idempotencyKey: z.string().min(1).max(255),
  knowledgeSpaceId: UuidSchema,
  operationType: KnowledgeSpaceStagedCommitOperationTypeSchema,
  parseArtifactId: UuidSchema.optional(),
  projectionFingerprint: z.string().min(1).max(512).optional(),
  publishedObjectKey: ObjectStorageKeySchema.optional(),
  rawObjectKey: ObjectStorageKeySchema.optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  status: KnowledgeSpaceStagedCommitStatusSchema,
  tenantId: TenantIdSchema,
  updatedAt: DateTimeSchema,
});
export type KnowledgeSpaceStagedCommit = z.infer<typeof KnowledgeSpaceStagedCommitSchema>;

export const SourceSchema = z.object({
  /** Stable provider connection aggregate. Credentials remain behind that connection's ref. */
  connectionId: UuidSchema.optional(),
  createdAt: DateTimeSchema,
  /** Opaque SecretStore handle. Secret bytes are never part of the Source record. */
  credentialRef: z.string().min(16).max(255).optional(),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  name: z.string().min(1).max(200),
  permissionScope: PermissionScopeSchema,
  status: z.enum(["active", "syncing", "error", "disabled"]),
  type: z.enum(["upload", "object-storage", "connector", "web"]),
  updatedAt: DateTimeSchema,
  uri: z.string().min(1),
  /** Optimistic-concurrency version; bumped on every write, used for CAS updates. */
  version: z.number().int().min(1).default(1),
});
export type Source = z.infer<typeof SourceSchema>;

export const DocumentAssetSchema = z.object({
  createdAt: DateTimeSchema,
  filename: z.string().min(1).max(512),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  mimeType: z.string().min(1),
  objectKey: z.string().min(1),
  parserStatus: z.enum(["pending", "parsed", "failed"]),
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  sourceId: UuidSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  version: z.number().int().positive(),
});
export type DocumentAsset = z.infer<typeof DocumentAssetSchema>;

export const ParseElementSchema = z.object({
  id: z.string().min(1),
  metadata: MetadataSchema,
  pageNumber: z.number().int().positive().optional(),
  sectionPath: z.array(z.string().min(1)).default([]),
  text: z.string().optional(),
  type: z.enum(["title", "heading", "paragraph", "table", "list", "image", "code", "page-break"]),
});
export type ParseElement = z.infer<typeof ParseElementSchema>;

export const ParseArtifactSchema = z.object({
  artifactHash: Sha256Schema,
  contentType: z.enum(["text", "structured", "mixed"]),
  createdAt: DateTimeSchema,
  documentAssetId: UuidSchema,
  elements: z.array(ParseElementSchema),
  id: UuidSchema,
  metadata: MetadataSchema,
  parser: z.enum(["native-markdown", "native-html", "native-structured", "unstructured"]),
  updatedAt: DateTimeSchema.optional(),
  version: z.number().int().positive(),
});
export type ParseArtifact = z.infer<typeof ParseArtifactSchema>;

export const DocumentMultimodalBoundingBoxSchema = z.object({
  height: z.number().nonnegative(),
  width: z.number().nonnegative(),
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
});
export type DocumentMultimodalBoundingBox = z.infer<typeof DocumentMultimodalBoundingBoxSchema>;

export const DocumentMultimodalAssetVariantSchema = z.object({
  contentType: z.string().min(1).optional(),
  height: z.number().nonnegative().optional(),
  objectKey: ObjectStorageKeySchema.optional(),
  sha256: Sha256Schema.optional(),
  uri: z.string().min(1).max(2_048).optional(),
  width: z.number().nonnegative().optional(),
});
export type DocumentMultimodalAssetVariant = z.infer<typeof DocumentMultimodalAssetVariantSchema>;

export const DocumentMultimodalAssetRefSchema = z.object({
  contentType: z.string().min(1).optional(),
  objectKey: ObjectStorageKeySchema.optional(),
  sha256: Sha256Schema.optional(),
  uri: z.string().min(1).max(2_048).optional(),
  variants: z.record(DocumentMultimodalAssetVariantSchema).optional(),
});
export type DocumentMultimodalAssetRef = z.infer<typeof DocumentMultimodalAssetRefSchema>;

export const DocumentMultimodalEnrichmentStatusSchema = z.enum([
  "missing",
  "pending",
  "provided",
  "unsupported",
]);
export type DocumentMultimodalEnrichmentStatus = z.infer<
  typeof DocumentMultimodalEnrichmentStatusSchema
>;

export const DocumentMultimodalItemSchema = z.object({
  assetRef: DocumentMultimodalAssetRefSchema.optional(),
  boundingBox: DocumentMultimodalBoundingBoxSchema.optional(),
  caption: z.string().min(1).max(16_000).optional(),
  endOffset: z.number().int().nonnegative().optional(),
  enrichment: z.object({
    asset: DocumentMultimodalEnrichmentStatusSchema,
    caption: DocumentMultimodalEnrichmentStatusSchema,
    ocr: DocumentMultimodalEnrichmentStatusSchema,
    tableStructure: DocumentMultimodalEnrichmentStatusSchema,
    visualEmbedding: DocumentMultimodalEnrichmentStatusSchema,
  }),
  id: z.string().min(1).max(512),
  modality: z.enum(["code", "image", "page", "table"]),
  ocrText: z.string().min(1).max(64_000).optional(),
  pageNumber: z.number().int().positive().optional(),
  parseElementId: z.string().min(1).max(512),
  sectionPath: z.array(z.string().min(1)).default([]),
  sourceMetadata: MetadataSchema,
  startOffset: z.number().int().nonnegative().optional(),
  textPreview: z.string().min(1).max(4_000).optional(),
  title: z.string().min(1).max(2_000).optional(),
});
export type DocumentMultimodalItem = z.infer<typeof DocumentMultimodalItemSchema>;

export const DocumentMultimodalManifestSchema = z.object({
  artifactHash: Sha256Schema,
  createdAt: DateTimeSchema,
  documentAssetId: UuidSchema,
  id: UuidSchema,
  items: z.array(DocumentMultimodalItemSchema),
  knowledgeSpaceId: UuidSchema,
  manifestVersion: z.string().min(1).max(128),
  metadata: MetadataSchema,
  parseArtifactId: UuidSchema,
  publicationGenerationId: PublicationGenerationIdSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  version: z.number().int().positive(),
});
export type DocumentMultimodalManifest = z.infer<typeof DocumentMultimodalManifestSchema>;

export const DocumentOutlineTocSourceSchema = z.enum([
  "native-toc",
  "llm-inferred",
  "parser-heading",
  "fallback",
]);
export type DocumentOutlineTocSource = z.infer<typeof DocumentOutlineTocSourceSchema>;

export const DocumentOutlineTitleLocationSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    endOffset: z.number().int().nonnegative().optional(),
    matchedText: z.string().min(1).max(1_000).optional(),
    pageNumber: z.number().int().positive().optional(),
    source: DocumentOutlineTocSourceSchema,
    startOffset: z.number().int().nonnegative().optional(),
  })
  .refine(
    (location) =>
      location.startOffset === undefined ||
      location.endOffset === undefined ||
      location.endOffset >= location.startOffset,
    {
      message: "titleLocation endOffset must be greater than or equal to startOffset",
      path: ["endOffset"],
    },
  );
export type DocumentOutlineTitleLocation = z.infer<typeof DocumentOutlineTitleLocationSchema>;

export interface DocumentOutlineNode {
  readonly childNodeIds: readonly string[];
  readonly children: readonly DocumentOutlineNode[];
  readonly endOffset?: number | undefined;
  readonly endPage?: number | undefined;
  readonly id: string;
  readonly level: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sectionPath: readonly string[];
  readonly sourceElementIds: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly startOffset?: number | undefined;
  readonly startPage?: number | undefined;
  readonly summary?: string | undefined;
  readonly title: string;
  readonly titleLocation?: DocumentOutlineTitleLocation | undefined;
  readonly tocSource: DocumentOutlineTocSource;
}

export const DocumentOutlineNodeSchema = z.lazy(() =>
  z
    .object({
      childNodeIds: z.array(z.string().min(1).max(512)).default([]),
      children: z.array(DocumentOutlineNodeSchema).default([]),
      endOffset: z.number().int().nonnegative().optional(),
      endPage: z.number().int().positive().optional(),
      id: z.string().min(1).max(512),
      level: z.number().int().positive().max(64),
      metadata: MetadataSchema,
      sectionPath: z.array(z.string().min(1)).default([]),
      sourceElementIds: z.array(z.string().min(1).max(512)).default([]),
      sourceNodeIds: z.array(z.string().min(1).max(512)).default([]),
      startOffset: z.number().int().nonnegative().optional(),
      startPage: z.number().int().positive().optional(),
      summary: z.string().min(1).max(16_000).optional(),
      title: z.string().min(1).max(2_000),
      titleLocation: DocumentOutlineTitleLocationSchema.optional(),
      tocSource: DocumentOutlineTocSourceSchema,
    })
    .refine(
      (node) =>
        node.startOffset === undefined ||
        node.endOffset === undefined ||
        node.endOffset >= node.startOffset,
      {
        message: "outline node endOffset must be greater than or equal to startOffset",
        path: ["endOffset"],
      },
    )
    .refine(
      (node) =>
        node.startPage === undefined ||
        node.endPage === undefined ||
        node.endPage >= node.startPage,
      {
        message: "outline node endPage must be greater than or equal to startPage",
        path: ["endPage"],
      },
    ),
) as unknown as z.ZodType<DocumentOutlineNode>;

export const DocumentOutlineSchema = z.object({
  artifactHash: Sha256Schema,
  createdAt: DateTimeSchema,
  documentAssetId: UuidSchema,
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  nodes: z.array(DocumentOutlineNodeSchema),
  outlineVersion: z.string().min(1).max(128),
  parseArtifactId: UuidSchema,
  publicationGenerationId: PublicationGenerationIdSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
  version: z.number().int().positive(),
});
export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;

/**
 * Text offsets are half-open UTF-8 byte ranges into the canonical parser text: each non-empty
 * element is Unicode-whitespace-trimmed and adjacent elements are separated by one LF byte.
 */
export const SourceLocationSchema = z.object({
  endOffset: z.number().int().nonnegative().optional(),
  pageNumber: z.number().int().positive().optional(),
  sectionPath: z.array(z.string().min(1)).default([]),
  startOffset: z.number().int().nonnegative().optional(),
});
export type SourceLocation = z.infer<typeof SourceLocationSchema>;

export const ArtifactSegmentTypeSchema = z.enum([
  "text",
  "table",
  "image",
  "code",
  "metadata",
  "binary",
  "page",
]);
export type ArtifactSegmentType = z.infer<typeof ArtifactSegmentTypeSchema>;

export const ArtifactSegmentSchema = z
  .object({
    artifactHash: Sha256Schema,
    checksum: Sha256Schema,
    contentEncoding: z.enum(["utf-8", "json", "binary"]).default("utf-8"),
    createdAt: DateTimeSchema,
    documentAssetId: UuidSchema,
    endOffset: z.number().int().nonnegative().optional(),
    id: UuidSchema,
    inlineText: z
      .string()
      .max(64 * 1024)
      .optional(),
    knowledgeSpaceId: UuidSchema,
    metadata: MetadataSchema,
    objectKey: ObjectStorageKeySchema.optional(),
    parseArtifactId: UuidSchema,
    segmentIndex: z.number().int().nonnegative(),
    segmentType: ArtifactSegmentTypeSchema,
    sizeBytes: z.number().int().nonnegative().optional(),
    sourceLocation: SourceLocationSchema,
    startOffset: z.number().int().nonnegative().optional(),
    updatedAt: DateTimeSchema.optional(),
  })
  .refine((segment) => Boolean(segment.inlineText || segment.objectKey), {
    message: "Artifact segment requires inlineText or objectKey",
  })
  .refine(
    (segment) =>
      segment.startOffset === undefined ||
      segment.endOffset === undefined ||
      segment.endOffset >= segment.startOffset,
    {
      message: "endOffset must be greater than or equal to startOffset",
      path: ["endOffset"],
    },
  );
export type ArtifactSegment = z.infer<typeof ArtifactSegmentSchema>;

export const KnowledgeNodeSchema = z
  .object({
    artifactHash: Sha256Schema,
    documentAssetId: UuidSchema,
    endOffset: z.number().int().nonnegative(),
    id: UuidSchema,
    kind: z.enum(["chunk", "section", "table", "image", "summary"]),
    knowledgeSpaceId: UuidSchema,
    metadata: MetadataSchema,
    parseArtifactId: UuidSchema,
    permissionScope: PermissionScopeSchema,
    publicationGenerationId: PublicationGenerationIdSchema.optional(),
    sourceLocation: SourceLocationSchema,
    startOffset: z.number().int().nonnegative(),
    text: z.string().min(1),
    updatedAt: DateTimeSchema.optional(),
  })
  .refine((node) => node.endOffset >= node.startOffset, {
    message: "endOffset must be greater than or equal to startOffset",
    path: ["endOffset"],
  });
export type KnowledgeNode = z.infer<typeof KnowledgeNodeSchema>;

export const IndexProjectionSchema = z.object({
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  model: z.string().min(1).max(255).optional(),
  nodeId: UuidSchema,
  projectionVersion: z.number().int().positive(),
  publicationGenerationId: PublicationGenerationIdSchema.optional(),
  status: z.enum(["building", "ready", "stale", "failed"]),
  type: z.enum(["dense-vector", "fts", "metadata", "graph"]),
  updatedAt: DateTimeSchema.optional(),
});
export type IndexProjection = z.infer<typeof IndexProjectionSchema>;

export const ProjectionSetFingerprintSchema = z
  .string()
  .regex(/^projection-set-sha256:[a-f0-9]{64}$/);
export type ProjectionSetFingerprint = z.infer<typeof ProjectionSetFingerprintSchema>;

export const ProjectionSetProjectionConfigSchema = z.object({
  indexVersion: z.string().min(1).max(128),
  model: z.string().min(1).max(256).optional(),
  projectionVersion: z.number().int().positive(),
  strategy: z.string().min(1).max(128),
  type: IndexProjectionSchema.shape.type,
});
export type ProjectionSetProjectionConfig = z.infer<typeof ProjectionSetProjectionConfigSchema>;

export const ProjectionSetSourceSnapshotSchema = z.object({
  artifactHash: Sha256Schema.optional(),
  documentAssetId: UuidSchema,
  sha256: Sha256Schema,
  version: z.number().int().positive(),
});
export type ProjectionSetSourceSnapshot = z.infer<typeof ProjectionSetSourceSnapshotSchema>;

export const ProjectionSetFingerprintMaterialSchema = z.object({
  chunkerVersion: z.string().min(1).max(128),
  indexVersion: z.string().min(1).max(128),
  knowledgeSpaceId: UuidSchema,
  nodeSchemaVersion: z.number().int().positive(),
  parserPolicyVersion: z.string().min(1).max(128),
  projectionSetVersion: z.string().min(1).max(128),
  projections: z.array(ProjectionSetProjectionConfigSchema).min(1),
  sourceSnapshots: z.array(ProjectionSetSourceSnapshotSchema).min(1),
});
export type ProjectionSetFingerprintMaterial = z.infer<
  typeof ProjectionSetFingerprintMaterialSchema
>;

export async function buildProjectionSetFingerprint(
  input: ProjectionSetFingerprintMaterial,
): Promise<ProjectionSetFingerprint> {
  const material = normalizeProjectionSetFingerprintMaterial(input);
  const digest = await sha256Hex(stableJson(material));

  return ProjectionSetFingerprintSchema.parse(`projection-set-sha256:${digest}`);
}

export function normalizeProjectionSetFingerprintMaterial(
  input: ProjectionSetFingerprintMaterial,
): ProjectionSetFingerprintMaterial {
  const material = ProjectionSetFingerprintMaterialSchema.parse(input);

  return {
    ...material,
    projections: [...material.projections].sort(compareProjectionSetProjectionConfig),
    sourceSnapshots: [...material.sourceSnapshots].sort(compareProjectionSetSourceSnapshot),
  };
}

export const EmbeddingModelSchema = z.object({
  createdAt: DateTimeSchema,
  dimension: z.number().int().positive(),
  id: UuidSchema,
  maxTokens: z.number().int().positive(),
  metadata: MetadataSchema,
  metric: z.enum(["cosine", "dot", "l2"]),
  modelId: z.string().min(1).max(255),
  provider: z.string().min(1).max(64),
  status: z.enum(["active", "candidate", "deprecated", "disabled"]),
  tokenizer: z.string().min(1),
  updatedAt: DateTimeSchema,
  version: z.string().min(1).max(128),
});
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;

export const KnowledgeFsNamespaceSchema = z.enum(KnowledgeFsNamespaceValues);
export type KnowledgeFsNamespace = z.infer<typeof KnowledgeFsNamespaceSchema>;

export interface KnowledgeFsNamespaceSpec {
  readonly root: `/${KnowledgeFsNamespace}`;
  readonly supportsPhysicalViews: boolean;
}

const KnowledgeFsNamespaceSpecs = {
  evidence: {
    root: "/evidence",
    supportsPhysicalViews: false,
  },
  knowledge: {
    root: "/knowledge",
    supportsPhysicalViews: true,
  },
  sources: {
    root: "/sources",
    supportsPhysicalViews: true,
  },
  workspaces: {
    root: "/workspaces",
    supportsPhysicalViews: false,
  },
} as const satisfies Record<KnowledgeFsNamespace, KnowledgeFsNamespaceSpec>;

const knowledgeFsNamespacePattern = KnowledgeFsNamespaceSchema.options.join("|");
const KnowledgeFsVirtualPathSchema = z
  .string()
  .max(384)
  .regex(new RegExp(`^/(?:${knowledgeFsNamespacePattern})(?:/[^/\\s]+)*$`));

export function getKnowledgeFsNamespaceSpec(
  namespace: KnowledgeFsNamespace,
): KnowledgeFsNamespaceSpec {
  const parsed = KnowledgeFsNamespaceSchema.parse(namespace);

  return { ...KnowledgeFsNamespaceSpecs[parsed] };
}

export function getKnowledgeFsPathNamespace(virtualPath: string): KnowledgeFsNamespace {
  const parsed = KnowledgeFsVirtualPathSchema.safeParse(virtualPath);

  if (!parsed.success) {
    throw new Error("KnowledgeFS path must start with a known namespace");
  }

  const namespace = parsed.data.split("/")[1];

  return KnowledgeFsNamespaceSchema.parse(namespace);
}

export function buildKnowledgeFsPath(
  namespace: KnowledgeFsNamespace,
  segments: readonly string[] = [],
): string {
  const spec = getKnowledgeFsNamespaceSpec(namespace);

  for (const segment of segments) {
    if (segment.length === 0) {
      throw new Error("KnowledgeFS path segments must not be empty");
    }

    if (segment.includes("/")) {
      throw new Error("KnowledgeFS path segments must not contain slashes");
    }

    if (/\s/.test(segment)) {
      throw new Error("KnowledgeFS path segments must not contain whitespace");
    }
  }

  return [spec.root, ...segments].join("/");
}

export const ResourceMountCapabilitySchema = z.enum([
  "ls",
  "tree",
  "cat",
  "grep",
  "find",
  "stat",
  "diff",
  "sync",
  "watch",
]);
export type ResourceMountCapability = z.infer<typeof ResourceMountCapabilitySchema>;

export const ResourceMountCachePolicySchema = z
  .object({
    maxBytes: z.number().int().positive().max(1_073_741_824).optional(),
    strategy: z.enum(["none", "memory", "object-storage"]),
    ttlSeconds: z.number().int().positive().max(86_400).optional(),
  })
  .default({ strategy: "none" });
export type ResourceMountCachePolicy = z.infer<typeof ResourceMountCachePolicySchema>;

export const ResourceMountSchema = z.object({
  cachePolicy: ResourceMountCachePolicySchema,
  capabilities: z.array(ResourceMountCapabilitySchema).default([]),
  createdAt: DateTimeSchema,
  freshnessPolicy: z.object({
    staleAfterSeconds: z.number().int().positive().optional(),
    strategy: z.enum(["realtime", "ttl", "manual", "async"]),
  }),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  lastSyncedAt: DateTimeSchema.optional(),
  metadata: MetadataSchema,
  mode: z.enum(["read", "write", "exec"]),
  mountPath: KnowledgeFsVirtualPathSchema,
  permissionScope: PermissionScopeSchema,
  permissionSnapshotVersion: z.number().int().positive(),
  provider: z.enum([
    "upload",
    "object-storage",
    "connector",
    "web",
    "database",
    "github",
    "slack",
    "internal",
  ]),
  resourceType: z.enum(["source", "document", "node", "artifact", "evidence", "workspace"]),
  sourcePointer: z.string().min(1),
  tenantId: TenantIdSchema,
});
export type ResourceMount = z.infer<typeof ResourceMountSchema>;

export const KnowledgePathSchema = z.object({
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  publicationGenerationId: PublicationGenerationIdSchema.optional(),
  resourceType: z.enum(["source", "document", "node", "artifact", "evidence", "workspace"]),
  targetId: z.string().min(1).max(512),
  version: z.number().int().positive().optional(),
  viewName: z
    .string()
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  viewType: z.enum(["physical", "semantic"]),
  virtualPath: KnowledgeFsVirtualPathSchema,
});
export type KnowledgePath = z.infer<typeof KnowledgePathSchema>;

export const CitationSchema = z
  .object({
    artifactHash: Sha256Schema.optional(),
    documentAssetId: UuidSchema,
    documentVersion: z.number().int().positive(),
    endOffset: z.number().int().nonnegative().optional(),
    pageNumber: z.number().int().positive().optional(),
    sectionPath: z.array(z.string().min(1)).default([]),
    startOffset: z.number().int().nonnegative().optional(),
  })
  .refine(
    (citation) =>
      citation.startOffset === undefined ||
      citation.endOffset === undefined ||
      citation.startOffset <= citation.endOffset,
    "Citation startOffset must be less than or equal to endOffset",
  );
export type Citation = z.infer<typeof CitationSchema>;

const EvidenceScoreValueSchema = z.number().min(0).max(1);

export const EvidenceScoresSchema = z.object({
  final: EvidenceScoreValueSchema,
  freshness: EvidenceScoreValueSchema.optional(),
  rerank: EvidenceScoreValueSchema.optional(),
  retrieval: EvidenceScoreValueSchema,
});
export type EvidenceScores = z.infer<typeof EvidenceScoresSchema>;

export const EvidenceFreshnessSchema = z.object({
  observedAt: DateTimeSchema.optional(),
  sourceUpdatedAt: DateTimeSchema.optional(),
  status: z.enum(["fresh", "stale", "unknown"]),
});
export type EvidenceFreshness = z.infer<typeof EvidenceFreshnessSchema>;

export const EvidenceConflictSchema = z.object({
  reason: z.string().min(1).max(2000),
  severity: z.enum(["info", "warning", "blocking"]),
  withNodeId: UuidSchema.optional(),
});
export type EvidenceConflict = z.infer<typeof EvidenceConflictSchema>;

export const MissingEvidenceSchema = z.object({
  expectedEvidenceId: UuidSchema.optional(),
  metadata: MetadataSchema,
  reason: z.enum(["not-retrieved", "permission-filtered", "stale", "conflict", "unknown"]),
  text: z.string().min(1).max(4000),
});
export type MissingEvidence = z.infer<typeof MissingEvidenceSchema>;

export const EvidenceItemSchema = z.object({
  citations: z.array(CitationSchema).min(1),
  conflicts: z.array(EvidenceConflictSchema).default([]),
  freshness: EvidenceFreshnessSchema,
  metadata: MetadataSchema,
  nodeId: UuidSchema,
  score: z.number().min(0).max(1),
  scores: EvidenceScoresSchema,
  text: z.string().min(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceBundleSchema = z.object({
  createdAt: DateTimeSchema,
  id: UuidSchema,
  items: z.array(EvidenceItemSchema),
  missingEvidence: z.array(MissingEvidenceSchema).default([]),
  query: z.string().min(1),
  state: z.enum(["answerable", "partial", "not-enough-evidence", "conflict", "permission-limited"]),
  traceId: UuidSchema.optional(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

export const GoldenQuestionSchema = z.object({
  createdAt: DateTimeSchema,
  expectedEvidenceIds: z.array(UuidSchema).default([]),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  question: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(80)).default([]),
  updatedAt: DateTimeSchema,
});
export type GoldenQuestion = z.infer<typeof GoldenQuestionSchema>;

export const AnswerTraceStepSchema = z.object({
  endedAt: DateTimeSchema.optional(),
  metadata: MetadataSchema,
  name: z.string().min(1),
  startedAt: DateTimeSchema,
  status: z.enum(["ok", "error", "skipped"]),
});
export type AnswerTraceStep = z.infer<typeof AnswerTraceStepSchema>;

export const AnswerTraceSchema = z.object({
  /** Durable Capability v2 provenance; mutually exclusive with legacy member snapshots. */
  capabilityGrantId: UuidSchema.optional(),
  createdAt: DateTimeSchema,
  evidenceBundleId: UuidSchema.optional(),
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  mode: z.enum(["fast", "deep", "research", "auto"]),
  permissionSnapshot: z
    .object({
      accessChannel: z.enum(["interactive", "service_api", "mcp", "agent"]),
      id: UuidSchema,
      revision: z.number().int().min(1),
    })
    .optional(),
  query: z.string().min(1),
  /** Authenticated creator. Legacy traces without it are intentionally unreadable via the API. */
  subjectId: z.string().min(1).max(255).optional(),
  steps: z.array(AnswerTraceStepSchema),
  /** Namespace binding required when capabilityGrantId is present. */
  tenantId: TenantIdSchema.optional(),
});
export type AnswerTrace = z.infer<typeof AnswerTraceSchema>;

export const FailedQuerySchema = z.object({
  answerTraceId: z.string().min(1).optional(),
  createdAt: DateTimeSchema,
  id: UuidSchema,
  knowledgeSpaceId: UuidSchema,
  metadata: MetadataSchema,
  mode: z.enum(["fast", "deep", "research", "auto"]),
  query: z.string().min(1),
  status: z.enum([
    "pending-triage",
    "triaged",
    "pending-annotation",
    "annotated",
    "dismissed",
    "promoted",
  ]),
  trigger: z.enum(["no-retrieval-evidence", "low-confidence", "abstained"]),
  updatedAt: DateTimeSchema,
});
export type FailedQuery = z.infer<typeof FailedQuerySchema>;

function compareProjectionSetProjectionConfig(
  left: ProjectionSetProjectionConfig,
  right: ProjectionSetProjectionConfig,
): number {
  return (
    left.type.localeCompare(right.type) ||
    (left.model ?? "").localeCompare(right.model ?? "") ||
    left.strategy.localeCompare(right.strategy) ||
    left.indexVersion.localeCompare(right.indexVersion) ||
    left.projectionVersion - right.projectionVersion
  );
}

function compareProjectionSetSourceSnapshot(
  left: ProjectionSetSourceSnapshot,
  right: ProjectionSetSourceSnapshot,
): number {
  return (
    left.documentAssetId.localeCompare(right.documentAssetId) ||
    left.version - right.version ||
    left.sha256.localeCompare(right.sha256) ||
    (left.artifactHash ?? "").localeCompare(right.artifactHash ?? "")
  );
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
