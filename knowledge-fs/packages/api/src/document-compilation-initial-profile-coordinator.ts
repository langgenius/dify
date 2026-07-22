import {
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceManifest,
  type KnowledgeSpacePendingModelConfiguration,
  createKnowledgeSpaceRetrievalProfile,
  updateKnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";

import type { DocumentCompilationProfileReference } from "./document-compilation-attempt-repository";
import {
  type DocumentCompilationExecutionContext,
  DocumentCompilationProcessingError,
} from "./document-compilation-runtime";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type {
  KnowledgeSpaceProfileHead,
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceUnpublishedProfileActivationRepository,
} from "./knowledge-space-profile-repository";
import {
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
  type ModelCapabilitySnapshot,
} from "./model-capability-preflight";

export interface DocumentCompilationInitialProfileCoordinator {
  /** Ensures the leased attempt is bound to an immutable, verified profile tuple. */
  ensureReady(execution: DocumentCompilationExecutionContext): Promise<void>;
}

export interface DocumentCompilationInitialProfileCoordinatorOptions {
  readonly activations: KnowledgeSpaceUnpublishedProfileActivationRepository;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get" | "update">;
  readonly now?: (() => string) | undefined;
  readonly preflight: ModelCapabilityPreflight;
  readonly profiles: Pick<KnowledgeSpaceProfileRepository, "getHead">;
}

interface VerifiedInitialProfiles {
  readonly embedding?: {
    readonly capability: ModelCapabilitySnapshot;
    readonly profile: ReturnType<typeof KnowledgeSpaceEmbeddingProfileSchema.parse>;
  };
  readonly retrieval: {
    readonly capability: Readonly<Record<string, unknown>>;
    readonly profile: ReturnType<typeof createKnowledgeSpaceRetrievalProfile>;
  };
}

/**
 * Lazy model activation for an empty knowledge space. Space creation persists only selections;
 * the first durable compilation probes Dify's tenant-bound model runtime, derives the real embedding dimension and
 * installs immutable profile heads before parsing or indexing starts.
 *
 * The local promise map suppresses duplicate probes in one API process. Database manifest/profile
 * CAS remains the cross-process authority, so duplicate workers can only converge on the same
 * immutable snapshots and can never publish an unverified tuple.
 */
export function createDocumentCompilationInitialProfileCoordinator({
  activations,
  manifests,
  now = () => new Date().toISOString(),
  preflight,
  profiles,
}: DocumentCompilationInitialProfileCoordinatorOptions): DocumentCompilationInitialProfileCoordinator {
  const inFlight = new Map<string, Promise<void>>();

  return {
    ensureReady: async (execution) => {
      let existingHeads: Awaited<ReturnType<typeof activeProfileHeads>>;
      let manifest: KnowledgeSpaceManifest | null;
      try {
        [existingHeads, manifest] = await Promise.all([
          activeProfileHeads(profiles, execution.attempt),
          manifests.get(execution.attempt),
        ]);
      } catch (error) {
        throw compilationError(
          "MODEL_PROFILE_STATE_READ_FAILED",
          "Knowledge-space model state could not be read and will be retried",
          true,
          error,
        );
      }
      if (!manifest) {
        throw compilationError(
          "KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND",
          "Knowledge-space model configuration is unavailable",
          false,
        );
      }
      if (
        existingHeads.retrieval &&
        !manifest.pendingModelConfiguration &&
        activeTupleSupportsCompilation(existingHeads)
      ) {
        if (execution.attempt.retrievalProfile) return;
        await bindInitialProfiles(execution, {
          ...(existingHeads.embedding
            ? { embeddingProfile: profileReference(existingHeads.embedding) }
            : {}),
          retrievalProfile: profileReference(existingHeads.retrieval),
        });
        return;
      }
      if (existingHeads.retrieval && !manifest.pendingModelConfiguration) {
        throw compilationError(
          "MODEL_PROFILE_ACTIVATION_INCOMPLETE",
          "Fast/Deep retrieval requires an active embedding profile",
          false,
        );
      }
      const pending = requireCompletePendingConfiguration(manifest);
      const key = `${manifest.tenantId}:${manifest.knowledgeSpaceId}:${pending.digest}`;
      let activation = inFlight.get(key);
      if (!activation) {
        activation = activatePendingConfiguration({
          activations,
          execution,
          manifests,
          now,
          pending,
          preflight,
        }).finally(() => inFlight.delete(key));
        inFlight.set(key, activation);
      }
      await activation;

      let heads: Awaited<ReturnType<typeof activeProfileHeads>>;
      try {
        heads = await activeProfileHeads(profiles, execution.attempt);
      } catch (error) {
        throw compilationError(
          "MODEL_PROFILE_STATE_READ_FAILED",
          "Activated model state could not be read and will be retried",
          true,
          error,
        );
      }
      if (!heads.retrieval) {
        throw compilationError(
          "MODEL_PROFILE_ACTIVATION_INCOMPLETE",
          "Knowledge-space model validation has not completed",
          true,
        );
      }
      await bindInitialProfiles(execution, {
        ...(heads.embedding ? { embeddingProfile: profileReference(heads.embedding) } : {}),
        retrievalProfile: profileReference(heads.retrieval),
      });
    },
  };
}

async function bindInitialProfiles(
  execution: DocumentCompilationExecutionContext,
  profiles: {
    readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
    readonly retrievalProfile: DocumentCompilationProfileReference;
  },
): Promise<void> {
  try {
    await execution.bindInitialProfiles(profiles);
  } catch (error) {
    if (error instanceof DocumentCompilationProcessingError) throw error;
    throw compilationError(
      "MODEL_PROFILE_BIND_FAILED",
      "The verified model tuple could not be bound and will be retried",
      true,
      error,
    );
  }
}

async function activatePendingConfiguration(input: {
  readonly activations: KnowledgeSpaceUnpublishedProfileActivationRepository;
  readonly execution: DocumentCompilationExecutionContext;
  readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get" | "update">;
  readonly now: () => string;
  readonly pending: KnowledgeSpacePendingModelConfiguration;
  readonly preflight: ModelCapabilityPreflight;
}): Promise<void> {
  const { attempt } = input.execution;
  const permission = initialActivationPermission(attempt);
  let verified: VerifiedInitialProfiles;
  try {
    verified = await verifyPendingConfiguration(
      input.preflight,
      input.pending,
      attempt.tenantId,
      input.execution.signal,
    );
  } catch (error) {
    const classified = classifyInitialProfileError(error);
    if (!classified.retryable) {
      let recorded: "recorded" | "stale";
      try {
        recorded = await recordValidationFailure(input, classified, permission);
      } catch (persistenceError) {
        throw compilationError(
          "MODEL_VALIDATION_FAILURE_PERSISTENCE_FAILED",
          "Model validation status could not be persisted and will be retried",
          true,
          persistenceError,
        );
      }
      if (recorded === "stale") {
        throw compilationError(
          "MODEL_CONFIGURATION_STALE",
          "The selected model configuration changed while it was being validated",
          true,
          error,
        );
      }
    }
    throw compilationError(classified.code, classified.message, classified.retryable, error);
  }

  try {
    const currentManifest = await input.manifests.get(input.execution.attempt);
    if (!currentManifest) {
      throw compilationError(
        "KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND",
        "Knowledge-space model configuration is unavailable",
        false,
      );
    }
    await input.activations.activateInitialTuple({
      createdBySubjectId: permission.requestedBySubjectId,
      ...(verified.embedding
        ? {
            embedding: {
              capabilitySnapshot: verified.embedding.capability,
              snapshot: verified.embedding.profile,
            },
          }
        : {}),
      expectedManifestVersion: currentManifest.manifestVersion,
      expectedPendingConfiguration: {
        digest: input.pending.digest,
        revision: input.pending.revision,
      },
      knowledgeSpaceId: input.execution.attempt.knowledgeSpaceId,
      now: input.now(),
      permission,
      requiredAccess: "write",
      retrieval: {
        capabilitySnapshot: verified.retrieval.capability,
        snapshot: verified.retrieval.profile,
      },
      tenantId: input.execution.attempt.tenantId,
    });
  } catch (error) {
    if (error instanceof DocumentCompilationProcessingError) throw error;
    throw compilationError(
      "MODEL_PROFILE_ACTIVATION_CONFLICT",
      "Knowledge-space model activation will be retried",
      true,
      error,
    );
  }
}

async function verifyPendingConfiguration(
  preflight: ModelCapabilityPreflight,
  pending: KnowledgeSpacePendingModelConfiguration,
  tenantId: string,
  signal: AbortSignal,
): Promise<VerifiedInitialProfiles> {
  const retrievalInput = pending.retrievalProfile;
  if (!retrievalInput) {
    throw compilationError(
      "KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED",
      "A retrieval model must be configured before documents can be compiled",
      false,
    );
  }
  const [embedding, reasoning, rerank] = await Promise.all([
    pending.embeddingSelection
      ? preflight.verify({
          kind: "embedding",
          selection: pending.embeddingSelection,
          signal,
          tenantId,
        })
      : undefined,
    preflight.verify({
      kind: "reasoning",
      selection: retrievalInput.reasoningModel,
      signal,
      tenantId,
    }),
    retrievalInput.rerank.enabled && retrievalInput.rerank.model
      ? preflight.verify({
          kind: "rerank",
          selection: retrievalInput.rerank.model,
          signal,
          tenantId,
        })
      : undefined,
  ]);
  if (retrievalInput.defaultMode !== "research" && (!pending.embeddingSelection || !embedding)) {
    throw new ModelCapabilityPreflightError(
      "MODEL_CAPABILITY_MISMATCH",
      "Fast/Deep retrieval requires an embedding model for this knowledge space",
    );
  }
  if (!reasoning) {
    throw new ModelCapabilityPreflightError(
      "MODEL_CAPABILITY_MISMATCH",
      "The reasoning model did not return a verified capability snapshot",
    );
  }

  let verifiedEmbedding: VerifiedInitialProfiles["embedding"];
  if (pending.embeddingSelection && embedding) {
    if (
      embedding.kind !== "embedding" ||
      embedding.dimension === undefined ||
      !embedding.distanceMetric
    ) {
      throw new ModelCapabilityPreflightError(
        "EMBEDDING_DIMENSION_INVALID",
        "The embedding model did not return a usable vector dimension",
      );
    }
    const profile = await updateKnowledgeSpaceEmbeddingProfile(
      undefined,
      pending.embeddingSelection,
      {
        capabilityDigest: embedding.capabilityDigest,
        dimension: embedding.dimension,
        distanceMetric: embedding.distanceMetric,
        pluginUniqueIdentifier: embedding.pluginUniqueIdentifier,
        schemaFingerprint: embedding.schemaFingerprint,
      },
    );
    verifiedEmbedding = {
      capability: embedding,
      profile: KnowledgeSpaceEmbeddingProfileSchema.parse({
        ...profile,
        dimension: embedding.dimension,
      }),
    };
  }

  return {
    ...(verifiedEmbedding ? { embedding: verifiedEmbedding } : {}),
    retrieval: {
      capability: {
        reasoning,
        rerank: rerank ?? null,
        verification: "verified",
      },
      profile: createKnowledgeSpaceRetrievalProfile(retrievalInput),
    },
  };
}

async function recordValidationFailure(
  input: {
    readonly execution: DocumentCompilationExecutionContext;
    readonly manifests: Pick<KnowledgeSpaceManifestRepository, "get" | "update">;
    readonly now: () => string;
    readonly pending: KnowledgeSpacePendingModelConfiguration;
  },
  failure: { readonly code: string; readonly retryable: boolean },
  permission: Parameters<
    KnowledgeSpaceUnpublishedProfileActivationRepository["activate"]
  >[0]["permission"],
): Promise<"recorded" | "stale"> {
  const scope = input.execution.attempt;
  for (let retry = 0; retry < 5; retry += 1) {
    const manifest = await input.manifests.get(scope);
    if (
      !manifest?.pendingModelConfiguration ||
      manifest.pendingModelConfiguration.digest !== input.pending.digest ||
      manifest.pendingModelConfiguration.revision !== input.pending.revision
    ) {
      return "stale";
    }
    const timestamp = input.now();
    const updated = await input.manifests.update({
      expectedManifestVersion: manifest.manifestVersion,
      knowledgeSpaceId: scope.knowledgeSpaceId,
      permission: { fence: permission, now: timestamp, requiredAccess: "write" },
      patch: {
        manifestVersion: manifest.manifestVersion + 1,
        pendingModelConfiguration: {
          ...manifest.pendingModelConfiguration,
          failure: {
            code: failure.code.slice(0, 64),
            failedAt: timestamp,
            retryable: failure.retryable,
          },
          state: "validation-failed",
        },
        updatedAt: timestamp,
      },
      tenantId: scope.tenantId,
    });
    if (updated) return "recorded";
  }
  throw new Error("Model validation failure manifest CAS retries were exhausted");
}

function requireCompletePendingConfiguration(
  manifest: KnowledgeSpaceManifest,
): KnowledgeSpacePendingModelConfiguration {
  const pending = manifest.pendingModelConfiguration;
  if (!pending?.retrievalProfile) {
    throw compilationError(
      "KNOWLEDGE_SPACE_MODEL_CONFIGURATION_REQUIRED",
      "A retrieval model must be configured before documents can be compiled",
      false,
    );
  }
  return pending;
}

async function activeProfileHeads(
  profiles: Pick<KnowledgeSpaceProfileRepository, "getHead">,
  scope: { readonly knowledgeSpaceId: string; readonly tenantId: string },
): Promise<{
  readonly embedding: KnowledgeSpaceProfileHead | null;
  readonly retrieval: KnowledgeSpaceProfileHead | null;
}> {
  const [embedding, retrieval] = await Promise.all([
    profiles.getHead({ ...scope, kind: "embedding" }),
    profiles.getHead({ ...scope, kind: "retrieval" }),
  ]);
  return { embedding, retrieval };
}

function profileReference(head: KnowledgeSpaceProfileHead): DocumentCompilationProfileReference {
  return {
    kind: head.kind,
    revision: head.activeRevision,
    revisionId: head.profileRevisionId,
    snapshotDigest: head.profile.snapshotDigest,
  };
}

function activeTupleSupportsCompilation(heads: {
  readonly embedding: KnowledgeSpaceProfileHead | null;
  readonly retrieval: KnowledgeSpaceProfileHead | null;
}): boolean {
  if (!heads.retrieval) return false;
  const retrieval = heads.retrieval.profile.snapshot;
  return (
    "defaultMode" in retrieval && (retrieval.defaultMode === "research" || heads.embedding !== null)
  );
}

function initialActivationPermission(
  attempt: DocumentCompilationExecutionContext["attempt"],
): Parameters<KnowledgeSpaceUnpublishedProfileActivationRepository["activate"]>[0]["permission"] {
  if (!attempt.permissionSnapshot || !attempt.requestedBySubjectId) {
    throw compilationError(
      "MODEL_PROFILE_ACTIVATION_PERMISSION_REQUIRED",
      "A durable write permission is required to activate the model configuration",
      false,
    );
  }
  return {
    accessChannel: attempt.permissionSnapshot.accessChannel,
    knowledgeSpaceId: attempt.knowledgeSpaceId,
    permissionSnapshotId: attempt.permissionSnapshot.id,
    permissionSnapshotRevision: attempt.permissionSnapshot.revision,
    requestedBySubjectId: attempt.requestedBySubjectId,
    tenantId: attempt.tenantId,
  };
}

function classifyInitialProfileError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
} {
  if (error instanceof DocumentCompilationProcessingError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof ModelCapabilityPreflightError) {
    return {
      code: error.code,
      message: "The selected model could not be validated",
      retryable: error.retryable,
    };
  }
  return {
    code: "MODEL_PREFLIGHT_FAILED",
    message: "The selected model could not be validated",
    retryable: true,
  };
}

function compilationError(
  code: string,
  message: string,
  retryable: boolean,
  cause?: unknown,
): DocumentCompilationProcessingError {
  return new DocumentCompilationProcessingError(message, {
    ...(cause === undefined ? {} : { cause }),
    code,
    retryable,
  });
}
