import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  type AuthSubject,
  type KnowledgeSpace,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceEmbeddingSelection,
  type KnowledgeSpaceManifest,
  type KnowledgeSpaceRetrievalProfile,
  type KnowledgeSpaceRetrievalProfileInput,
  KnowledgeSpaceRetrievalProfileSchema,
  type KnowledgeSpaceStagedCommit,
  type PlatformAdapter,
  buildKnowledgeSpaceVectorSpaceId,
  createKnowledgeSpaceRetrievalProfile,
  updateKnowledgeSpaceEmbeddingProfile,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import { issueKnowledgeSpaceDurablePermission } from "./derived-result-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type {
  IndexProjectionRepository,
  IndexProjectionVersionSummary,
} from "./index-projection-repository";
import {
  createKnowledgeFsArtifactSegmentFsckChecker,
  createKnowledgeFsRawObjectFsckChecker,
  createKnowledgeFsReferenceFsckChecker,
} from "./knowledge-fs-fsck";
import {
  createKnowledgeFsStagedObjectGcDryRun,
  createKnowledgeFsStagedObjectGcExecutor,
} from "./knowledge-fs-gc";
import {
  KnowledgeFsLeaseListLimitExceededError,
  type KnowledgeFsLeaseRepository,
} from "./knowledge-fs-lease-repository";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import type { KnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
  isKnowledgeSpaceExternalCallerKind,
} from "./knowledge-space-authorization";
import {
  createKnowledgeSpaceWithOptionalSlug,
  createWithOptionalKnowledgeSpaceSlug,
} from "./knowledge-space-creation";
import {
  type KnowledgeSpaceManifestRepository,
  createKnowledgeSpacePendingModelConfiguration,
  ensureKnowledgeSpaceManifest,
} from "./knowledge-space-manifest-repository";
import {
  type KnowledgeSpaceProfileMigrationService,
  toPublicKnowledgeSpaceProfileMigration,
} from "./knowledge-space-profile-migration-service";
import type { KnowledgeSpaceProfilePublicationRepository } from "./knowledge-space-profile-publication-repository";
import {
  type KnowledgeSpaceProfileRepository,
  type KnowledgeSpaceProfileRevision,
  KnowledgeSpaceProfileTransitionError,
  KnowledgeSpaceUnpublishedProfileActivationError,
  type KnowledgeSpaceUnpublishedProfileActivationRepository,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";
import {
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  KnowledgeSpaceProvisioningIncompleteReplayError,
  type KnowledgeSpaceProvisioningRepository,
  configurationStatusFor,
} from "./knowledge-space-provisioning-repository";
import {
  DuplicateKnowledgeSpaceSlugError,
  KnowledgeSpaceCapacityExceededError,
  KnowledgeSpaceListLimitExceededError,
  type KnowledgeSpaceRepository,
  KnowledgeSpaceRevisionConflictError,
} from "./knowledge-space-repository";
import {
  createKnowledgeSpaceRoute,
  executeKnowledgeSpaceStagedObjectGcRoute,
  getKnowledgeSpaceFsckRoute,
  getKnowledgeSpaceManifestRoute,
  getKnowledgeSpaceProductSettingsRoute,
  getKnowledgeSpaceRoute,
  getKnowledgeSpaceStagedObjectGcDryRunRoute,
  getKnowledgeSpaceStatsRoute,
  getKnowledgeSpaceStatusRoute,
  listKnowledgeSpaceActiveLeasesRoute,
  listKnowledgeSpaceStagedCommitsRoute,
  listKnowledgeSpacesRoute,
  updateKnowledgeSpaceEmbeddingProfileRoute,
  updateKnowledgeSpaceProductSettingsRoute,
  updateKnowledgeSpaceRetrievalProfileRoute,
  updateKnowledgeSpaceRoute,
} from "./knowledge-space-routes";
import {
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
  type ModelCapabilitySnapshot,
  ModelCapabilitySnapshotSchema,
} from "./model-capability-preflight";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";
import {
  StagedCommitListLimitExceededError,
  type StagedCommitRepository,
} from "./staged-commit-repository";

export interface RegisterKnowledgeSpaceHandlersOptions {
  readonly access: KnowledgeSpaceAccessService;
  readonly adapter: PlatformAdapter;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly authorization?: KnowledgeSpaceAuthorizationGuard | undefined;
  readonly assets: DocumentAssetRepository;
  readonly generateGcDryRunId: () => string;
  readonly generateManifestId: () => string;
  readonly generateProvisioningKey: () => string;
  readonly knowledgeFsLeases: KnowledgeFsLeaseRepository;
  readonly knowledgeFsSessions: KnowledgeFsSessionRepository;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly profileMigrations?: KnowledgeSpaceProfileMigrationService | undefined;
  readonly profilePublicationBindings?:
    | Pick<KnowledgeSpaceProfilePublicationRepository, "bindCurrentPublished">
    | undefined;
  readonly profiles?: KnowledgeSpaceProfileRepository | undefined;
  readonly provisioning?: KnowledgeSpaceProvisioningRepository | undefined;
  readonly unpublishedProfileActivations?:
    | KnowledgeSpaceUnpublishedProfileActivationRepository
    | undefined;
  readonly publishedPublications?:
    | Pick<ProjectionSetPublicationRepository, "getPublished">
    | undefined;
  readonly modelCapabilityPreflight?: ModelCapabilityPreflight | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly now: () => string;
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly parser: ParserAdapter;
  readonly projections: IndexProjectionRepository;
  readonly spaces: KnowledgeSpaceRepository;
  readonly stagedCommits: StagedCommitRepository;
}

export function registerKnowledgeSpaceHandlers({
  access,
  adapter,
  app,
  artifactSegments,
  authorization,
  assets,
  generateGcDryRunId,
  generateManifestId,
  generateProvisioningKey,
  knowledgeFsLeases,
  knowledgeFsSessions,
  manifests,
  profileMigrations,
  profilePublicationBindings,
  profiles,
  provisioning,
  unpublishedProfileActivations,
  publishedPublications,
  modelCapabilityPreflight,
  nodes,
  now,
  operationLeases,
  parseArtifacts,
  paths,
  parser,
  projections,
  spaces,
  stagedCommits,
}: RegisterKnowledgeSpaceHandlersOptions): void {
  app.openapi(createKnowledgeSpaceRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const { embeddingProfile, idempotencyKey, retrievalProfile, ...createInput } =
        context.req.valid("json");
      const profileValidationError = retrievalProfile
        ? validateKnowledgeSpaceRetrievalProfileForMode(
            retrievalProfile,
            retrievalProfile.defaultMode,
          )
        : undefined;
      if (profileValidationError) {
        return context.json(
          {
            code: profileValidationError.code,
            error: profileValidationError.message,
            mode: profileValidationError.mode,
          },
          400,
        );
      }
      const selectedEmbedding = embeddingProfile;
      if (retrievalProfile && retrievalProfile.defaultMode !== "research" && !selectedEmbedding) {
        throw new ModelCapabilityPreflightError(
          "MODEL_CAPABILITY_MISMATCH",
          "Fast/Deep retrieval requires an embedding model for this knowledge space",
        );
      }
      const pendingModelConfiguration =
        selectedEmbedding || retrievalProfile
          ? createKnowledgeSpacePendingModelConfiguration({
              ...(selectedEmbedding ? { embeddingSelection: selectedEmbedding } : {}),
              ...(retrievalProfile ? { retrievalProfile } : {}),
            })
          : undefined;

      if (provisioning) {
        const operationIdempotencyKey = idempotencyKey ?? generateProvisioningKey();
        const result = await createWithOptionalKnowledgeSpaceSlug(
          { ...createInput, tenantId: subject.tenantId },
          ({ description, iconRef, name, slug, tenantId }) =>
            provisioning.provision({
              createdBySubjectId: subject.subjectId,
              ...(description === undefined ? {} : { description }),
              ...(iconRef === undefined ? {} : { iconRef }),
              idempotencyKey: operationIdempotencyKey,
              name,
              ...(pendingModelConfiguration ? { pendingModelConfiguration } : {}),
              slug,
              slugSource: createInput.slug === undefined ? "generated" : "explicit",
              tenantId,
            }),
        );
        return context.json(
          { ...result.space, configurationStatus: result.configurationStatus },
          201,
        );
      }

      const space = await createKnowledgeSpaceWithOptionalSlug(spaces, {
        ...createInput,
        tenantId: subject.tenantId,
      });
      try {
        await ensureKnowledgeSpaceManifest({
          generateId: generateManifestId,
          manifests,
          now,
          ...(pendingModelConfiguration ? { pendingModelConfiguration } : {}),
          space,
        });
        // Access initialization is the final provisioning write. The repository performs its
        // member/policy/API-access writes atomically; if it fails, remove the already-created
        // manifest and space so no caller can observe a knowledge space without an owner.
        await access.initialize({
          knowledgeSpaceId: space.id,
          ownerSubjectId: subject.subjectId,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        await access
          .deleteAggregate({ knowledgeSpaceId: space.id, tenantId: subject.tenantId })
          .catch(() => false);
        await manifests
          .delete?.({ knowledgeSpaceId: space.id, tenantId: subject.tenantId })
          .catch(() => false);
        // The repositories do not currently share a transaction. Compensate so a failed manifest
        // or owner-policy write cannot strand an inaccessible slug.
        await spaces
          .rollbackCreate({
            expectedRevision: space.revision,
            expectedSlug: space.slug,
            id: space.id,
            tenantId: subject.tenantId,
          })
          .catch(() => false);
        throw error;
      }

      return context.json(
        {
          ...space,
          configurationStatus: configurationStatusFor(
            undefined,
            undefined,
            pendingModelConfiguration,
          ),
        },
        201,
      );
    } catch (error) {
      if (error instanceof DuplicateKnowledgeSpaceSlugError) {
        return context.json({ error: error.message }, 409);
      }

      if (error instanceof KnowledgeSpaceProvisioningIdempotencyConflictError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }

      if (error instanceof KnowledgeSpaceCapacityExceededError) {
        return context.json({ error: error.message }, 429);
      }

      if (error instanceof ModelCapabilityPreflightError) {
        return context.json(
          { code: error.code, error: error.message },
          error.retryable ? 503 : 422,
        );
      }

      if (error instanceof KnowledgeSpaceProvisioningIncompleteReplayError) {
        return context.json({ code: error.code, error: error.message }, 503);
      }

      /* v8 ignore next 2 -- unexpected knowledge-space create failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(listKnowledgeSpacesRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const query = context.req.valid("query");
      const callerKind = context.get("callerKind") ?? "interactive";
      const capabilityGrant = context.get("capabilityV2Grant");
      if (
        capabilityGrant &&
        (capabilityGrant.action !== "knowledge_spaces.list" ||
          capabilityGrant.namespaceId !== subject.tenantId ||
          capabilityGrant.subject !== subject.subjectId ||
          capabilityGrant.resource.type !== "namespace" ||
          capabilityGrant.resource.id !== subject.tenantId ||
          capabilityGrant.resource.parent_id !== null)
      ) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const result = capabilityGrant
        ? await spaces.list({ ...query, tenantId: subject.tenantId })
        : authorization && spaces.listAuthorized
          ? await spaces.listAuthorized({
              ...query,
              requireApiAccess: isKnowledgeSpaceExternalCallerKind(callerKind),
              subjectId: subject.subjectId,
              tenantId: subject.tenantId,
            })
          : authorization
            ? await listAuthorizedSpacesFallback({
                authorization,
                callerKind,
                cursor: query.cursor,
                limit: query.limit,
                spaces,
                subject,
              })
            : await spaces.list({ ...query, tenantId: subject.tenantId });

      return context.json(result, 200);
    } catch (error) {
      if (error instanceof KnowledgeSpaceListLimitExceededError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected knowledge-space list failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(getKnowledgeSpaceRoute, async (context) => {
    const subject = context.get("subject");
    const space = await spaces.get({
      id: context.req.valid("param").id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });

    return context.json(space, 200);
  });

  app.openapi(getKnowledgeSpaceManifestRoute, async (context) => {
    const subject = context.get("subject");
    const space = await spaces.get({
      id: context.req.valid("param").id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });

    return context.json(manifest, 200);
  });

  app.openapi(getKnowledgeSpaceProductSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    return context.json(toProductSettings(manifest), 200);
  });

  app.openapi(updateKnowledgeSpaceProductSettingsRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    if (manifest.manifestVersion !== body.expectedRevision) {
      return context.json(
        {
          code: "PRODUCT_SETTINGS_REVISION_CONFLICT",
          error: `Knowledge space product settings revision conflict: expected=${body.expectedRevision} actual=${manifest.manifestVersion}`,
        },
        409,
      );
    }
    if (manifest.embeddingProfile || manifest.retrievalProfile) {
      return context.json(
        {
          code: "PRODUCT_SETTINGS_PROFILE_MIGRATION_REQUIRED",
          error: "Active profile changes require the dedicated profile migration workflow",
        },
        409,
      );
    }

    const current = manifest.pendingModelConfiguration;
    const embeddingSelection = body.embedding ?? current?.embeddingSelection;
    const retrievalProfile = body.retrieval ?? current?.retrievalProfile;
    if (retrievalProfile?.defaultMode !== "research" && !embeddingSelection) {
      return context.json(
        {
          code: "EMBEDDING_MODEL_REQUIRED",
          error: "Fast/Deep retrieval requires an embedding model for this knowledge space",
        },
        409,
      );
    }
    const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
      ...(embeddingSelection ? { embeddingSelection } : {}),
      ...(retrievalProfile ? { retrievalProfile } : {}),
      revision: (current?.revision ?? 0) + 1,
    });
    const updatedAt = now();
    const updated = await manifests.update({
      expectedManifestVersion: manifest.manifestVersion,
      knowledgeSpaceId,
      patch: {
        manifestVersion: manifest.manifestVersion + 1,
        pendingModelConfiguration,
        updatedAt,
      },
      tenantId: subject.tenantId,
    });
    if (!updated) {
      return context.json(
        {
          code: "PRODUCT_SETTINGS_REVISION_CONFLICT",
          error: "Knowledge space product settings changed concurrently",
        },
        409,
      );
    }
    return context.json(toProductSettings(updated), 200);
  });

  app.openapi(updateKnowledgeSpaceEmbeddingProfileRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const selection = context.req.valid("json");
    let manifest = await manifests.get({
      knowledgeSpaceId,
      tenantId: subject.tenantId,
    });
    const current = manifest?.embeddingProfile;
    const pendingEmbeddingSelection = manifest?.pendingModelConfiguration?.embeddingSelection;
    const effectiveSelection = current ?? pendingEmbeddingSelection;
    const selectionChanged =
      !effectiveSelection ||
      effectiveSelection.pluginId !== selection.pluginId ||
      effectiveSelection.provider !== selection.provider ||
      effectiveSelection.model !== selection.model;
    const hasPublishedProfileTuple = profileMigrations
      ? await profileMigrations.requiresMigration({
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        })
      : publishedPublications
        ? (await publishedPublications.getPublished({
            knowledgeSpaceId,
            tenantId: subject.tenantId,
          })) !== null
        : false;
    manifest ??= await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const canUpdatePendingConfiguration =
      !hasPublishedProfileTuple &&
      manifest.embeddingProfile === undefined &&
      manifest.retrievalProfile === undefined;
    if (
      canUpdatePendingConfiguration &&
      !selectionChanged &&
      manifest.pendingModelConfiguration?.state !== "validation-failed"
    ) {
      const pendingModelConfiguration = manifest.pendingModelConfiguration;
      if (pendingModelConfiguration) {
        return context.json(
          {
            configurationStatus: pendingModelConfiguration.retrievalProfile
              ? ("pending-validation" as const)
              : ("setup-required" as const),
            digest: pendingModelConfiguration.digest,
            operation: "initial-validation-pending" as const,
            revision: pendingModelConfiguration.revision,
          },
          202,
        );
      }
    }
    if (
      canUpdatePendingConfiguration &&
      (selectionChanged || manifest.pendingModelConfiguration?.state === "validation-failed")
    ) {
      if (!authorization) {
        return context.json(
          {
            code: "PENDING_MODEL_CONFIGURATION_UNAVAILABLE",
            error: "Pending model configuration updates are unavailable",
          },
          503,
        );
      }
      const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
        embeddingSelection: selection,
        ...(manifest.pendingModelConfiguration?.retrievalProfile
          ? { retrievalProfile: manifest.pendingModelConfiguration.retrievalProfile }
          : {}),
        revision: (manifest.pendingModelConfiguration?.revision ?? 0) + 1,
      });
      const mutationTimestamp = now();
      const authenticatedApiKey = context.get("authenticatedApiKey");
      let permissionSnapshot: Awaited<ReturnType<typeof issueKnowledgeSpaceDurablePermission>>;
      try {
        permissionSnapshot = await issueKnowledgeSpaceDurablePermission({
          access,
          ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
          authorization,
          callerKind: context.get("callerKind") ?? "interactive",
          expiresAt: new Date(Date.parse(mutationTimestamp) + 10 * 60_000).toISOString(),
          knowledgeSpaceId,
          requiredAccess: "admin",
          subject,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeSpaceAuthorizationError ||
          error instanceof KnowledgeSpaceAccessError
        ) {
          return context.json({ code: error.code, error: "Knowledge space access denied" }, 403);
        }
        throw error;
      }
      const updated = await manifests.update({
        expectedManifestVersion: manifest.manifestVersion,
        knowledgeSpaceId,
        patch: {
          manifestVersion: manifest.manifestVersion + 1,
          pendingModelConfiguration,
          updatedAt: mutationTimestamp,
        },
        permission: {
          fence: {
            accessChannel: permissionSnapshot.accessChannel,
            knowledgeSpaceId,
            permissionSnapshotId: permissionSnapshot.id,
            permissionSnapshotRevision: permissionSnapshot.revision,
            requestedBySubjectId: subject.subjectId,
            tenantId: subject.tenantId,
          },
          now: mutationTimestamp,
          requiredAccess: "admin",
        },
        tenantId: subject.tenantId,
      });
      if (!updated) {
        return context.json(
          {
            code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
            error: "Pending model configuration changed concurrently",
          },
          409,
        );
      }
      return context.json(
        {
          configurationStatus: pendingModelConfiguration.retrievalProfile
            ? ("pending-validation" as const)
            : ("setup-required" as const),
          digest: pendingModelConfiguration.digest,
          operation: "initial-validation-pending" as const,
          revision: pendingModelConfiguration.revision,
        },
        202,
      );
    }
    const publishedMigrationRequired =
      selectionChanged &&
      hasPublishedProfileTuple &&
      profileMigrations !== undefined &&
      profiles !== undefined;

    if (selectionChanged && hasPublishedProfileTuple && !publishedMigrationRequired) {
      return context.json(
        {
          code: "PROFILE_MIGRATION_UNAVAILABLE",
          error: "Published embedding profile changes require the durable migration workflow",
        },
        503,
      );
    }

    if (selectionChanged && !publishedMigrationRequired) {
      if (manifest?.embeddingProfileFrozenAt) {
        return context.json({ error: "Embedding profile change requires reindex workflow" }, 409);
      }

      const [usage, nodePage] = await Promise.all([
        assets.getStorageUsage({ knowledgeSpaceId }),
        nodes.listBySpace({ knowledgeSpaceId, limit: 1 }),
      ]);

      if (usage.documentCount > 0 || nodePage.items.length > 0) {
        return context.json({ error: "Embedding profile change requires reindex workflow" }, 409);
      }
    }

    let capabilitySnapshot: ModelCapabilitySnapshot;
    try {
      if (!modelCapabilityPreflight) {
        throw new ModelCapabilityPreflightError(
          "MODEL_PREFLIGHT_UNAVAILABLE",
          "Model capability preflight is unavailable",
          { retryable: true },
        );
      }
      capabilitySnapshot = await modelCapabilityPreflight.verify({
        kind: "embedding",
        selection,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      if (error instanceof ModelCapabilityPreflightError) {
        return context.json(
          { code: error.code, error: error.message },
          error.retryable ? 503 : 422,
        );
      }
      throw error;
    }

    const previewBase = await updateKnowledgeSpaceEmbeddingProfile(
      current,
      selection,
      embeddingVectorSpaceIdentityFromSnapshot(capabilitySnapshot),
    );
    const previewProfile = {
      ...previewBase,
      dimension: capabilitySnapshot.dimension,
    };
    if (
      hasPublishedProfileTuple &&
      current &&
      knowledgeSpaceProfileSnapshotDigest(previewProfile) ===
        knowledgeSpaceProfileSnapshotDigest(current)
    ) {
      return context.json(previewProfile, 200);
    }

    if (profileMigrations && profiles) {
      const published = hasPublishedProfileTuple;
      if (published) {
        try {
          await ensureLegacyPublishedProfileTuple({
            createdBySubjectId: subject.subjectId,
            knowledgeSpaceId,
            manifest,
            modelCapabilityPreflight,
            now,
            profilePublicationBindings,
            profiles,
            tenantId: subject.tenantId,
          });
        } catch (error) {
          if (error instanceof ModelCapabilityPreflightError) {
            return context.json(
              { code: error.code, error: error.message },
              error.retryable ? 503 : 422,
            );
          }
          if (error instanceof LegacyProfileBootstrapError) {
            return context.json({ code: error.code, error: error.message }, error.status);
          }
          if (error instanceof SettingsProfileCandidateConflictError) {
            return context.json({ code: error.code, error: error.message }, 409);
          }
          return context.json(
            {
              code: "PROFILE_PUBLICATION_BOOTSTRAP_FAILED",
              error: "Published projection tuple could not be bound to verified active profiles",
            },
            503,
          );
        }
        const activeHead = await profiles.getHead({
          kind: "embedding",
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        });
        const candidateBase = await updateKnowledgeSpaceEmbeddingProfile(
          activeHead ? (activeHead.profile.snapshot as typeof current) : current,
          selection,
          embeddingVectorSpaceIdentityFromSnapshot(capabilitySnapshot),
        );
        if (!candidateBase) {
          throw new Error("Embedding candidate profile could not be created");
        }
        const candidateSnapshot = {
          ...candidateBase,
          dimension: capabilitySnapshot.dimension,
        };
        if (
          activeHead &&
          knowledgeSpaceProfileSnapshotDigest(candidateSnapshot) ===
            activeHead.profile.snapshotDigest
        ) {
          return context.json(candidateSnapshot, 200);
        }
        const createdAt = now();
        let candidate: KnowledgeSpaceProfileRevision;
        try {
          candidate = await getOrCreateSettingsProfileCandidate(profiles, {
            capabilitySnapshot,
            createdBySubjectId: subject.subjectId,
            kind: "embedding",
            knowledgeSpaceId,
            now: createdAt,
            snapshot: candidateSnapshot,
            tenantId: subject.tenantId,
          });
        } catch (error) {
          if (error instanceof SettingsProfileCandidateConflictError) {
            return context.json({ code: error.code, error: error.message }, 409);
          }
          throw error;
        }
        const authenticatedApiKey = context.get("authenticatedApiKey");
        const migration = await profileMigrations.request({
          ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
          callerKind: context.get("callerKind") ?? "interactive",
          candidateRevision: candidate.revision,
          changedKind: "embedding",
          idempotencyKey: `settings-embedding-${candidate.snapshotDigest}`,
          knowledgeSpaceId,
          subject,
        });
        return context.json(toPublicKnowledgeSpaceProfileMigration(migration), 202);
      }
    }
    if (hasPublishedProfileTuple) {
      return context.json(
        {
          code: "PROFILE_MIGRATION_UNAVAILABLE",
          error: "Published embedding profile changes require the durable migration workflow",
        },
        503,
      );
    }

    if (!authorization || !unpublishedProfileActivations) {
      return context.json(
        {
          code: "UNPUBLISHED_PROFILE_ACTIVATION_UNAVAILABLE",
          error: "Atomic unpublished profile activation is unavailable",
        },
        503,
      );
    }
    manifest ??= await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });

    try {
      const mutationTimestamp = now();
      const authenticatedApiKey = context.get("authenticatedApiKey");
      const permissionSnapshot = await issueKnowledgeSpaceDurablePermission({
        access,
        ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
        authorization,
        callerKind: context.get("callerKind") ?? "interactive",
        expiresAt: new Date(Date.parse(mutationTimestamp) + 10 * 60_000).toISOString(),
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      await unpublishedProfileActivations.activate({
        capabilitySnapshot,
        createdBySubjectId: subject.subjectId,
        expectedManifestProfileRevision: current?.revision ?? 0,
        expectedManifestVersion: manifest.manifestVersion,
        kind: "embedding",
        knowledgeSpaceId,
        now: mutationTimestamp,
        permission: {
          accessChannel: permissionSnapshot.accessChannel,
          knowledgeSpaceId,
          permissionSnapshotId: permissionSnapshot.id,
          permissionSnapshotRevision: permissionSnapshot.revision,
          requestedBySubjectId: subject.subjectId,
          tenantId: subject.tenantId,
        },
        snapshot: previewProfile,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      if (error instanceof KnowledgeSpaceUnpublishedProfileActivationError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceProfileTransitionError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      if (
        error instanceof KnowledgeSpaceAuthorizationError ||
        error instanceof KnowledgeSpaceAccessError
      ) {
        return context.json({ code: error.code, error: "Knowledge space access denied" }, 403);
      }

      throw error;
    }

    return context.json(previewProfile, 200);
  });

  app.openapi(updateKnowledgeSpaceRetrievalProfileRoute, async (context) => {
    const subject = context.get("subject");
    const knowledgeSpaceId = context.req.valid("param").id;
    const body = context.req.valid("json");
    const space = await spaces.get({ id: knowledgeSpaceId, tenantId: subject.tenantId });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const profileValidationError = validateKnowledgeSpaceRetrievalProfileForMode(
      body.profile,
      body.profile.defaultMode,
    );
    if (profileValidationError) {
      return context.json(
        {
          code: profileValidationError.code,
          error: profileValidationError.message,
          mode: profileValidationError.mode,
        },
        400,
      );
    }
    let currentManifest = await manifests.get({
      knowledgeSpaceId,
      tenantId: subject.tenantId,
    });
    const currentReasoning = currentManifest?.retrievalProfile?.reasoningModel;
    const reasoningChanged =
      currentReasoning !== undefined &&
      (currentReasoning.pluginId !== body.profile.reasoningModel.pluginId ||
        currentReasoning.provider !== body.profile.reasoningModel.provider ||
        currentReasoning.model !== body.profile.reasoningModel.model);
    const hasPublishedProfileTuple = profileMigrations
      ? await profileMigrations.requiresMigration({
          knowledgeSpaceId,
          tenantId: subject.tenantId,
        })
      : publishedPublications
        ? (await publishedPublications.getPublished({
            knowledgeSpaceId,
            tenantId: subject.tenantId,
          })) !== null
        : false;
    currentManifest ??= await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const canUpdatePendingConfiguration =
      !hasPublishedProfileTuple &&
      currentManifest.embeddingProfile === undefined &&
      currentManifest.retrievalProfile === undefined;
    if (canUpdatePendingConfiguration) {
      if (body.expectedRevision !== 0) {
        return context.json(
          {
            code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
            error: `Knowledge space retrieval profile revision conflict: expected=${body.expectedRevision} actual=0`,
          },
          409,
        );
      }
      const embeddingSelection = currentManifest.pendingModelConfiguration?.embeddingSelection;
      if (body.profile.defaultMode !== "research" && !embeddingSelection) {
        return context.json(
          {
            code: "EMBEDDING_MODEL_REQUIRED",
            error: "Fast/Deep retrieval requires an embedding model for this knowledge space",
          },
          409,
        );
      }
      if (!authorization) {
        return context.json(
          {
            code: "PENDING_MODEL_CONFIGURATION_UNAVAILABLE",
            error: "Pending model configuration updates are unavailable",
          },
          503,
        );
      }
      const currentPendingConfiguration = currentManifest.pendingModelConfiguration;
      if (currentPendingConfiguration?.state !== "validation-failed") {
        const idempotentCandidate = createKnowledgeSpacePendingModelConfiguration({
          ...(embeddingSelection ? { embeddingSelection } : {}),
          retrievalProfile: body.profile,
          revision: currentPendingConfiguration?.revision ?? 1,
        });
        if (
          currentPendingConfiguration &&
          idempotentCandidate.digest === currentPendingConfiguration.digest
        ) {
          return context.json(
            {
              configurationStatus: "pending-validation" as const,
              digest: currentPendingConfiguration.digest,
              operation: "initial-validation-pending" as const,
              revision: currentPendingConfiguration.revision,
            },
            202,
          );
        }
      }
      const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
        ...(embeddingSelection ? { embeddingSelection } : {}),
        retrievalProfile: body.profile,
        revision: (currentManifest.pendingModelConfiguration?.revision ?? 0) + 1,
      });
      const mutationTimestamp = now();
      const authenticatedApiKey = context.get("authenticatedApiKey");
      let permissionSnapshot: Awaited<ReturnType<typeof issueKnowledgeSpaceDurablePermission>>;
      try {
        permissionSnapshot = await issueKnowledgeSpaceDurablePermission({
          access,
          ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
          authorization,
          callerKind: context.get("callerKind") ?? "interactive",
          expiresAt: new Date(Date.parse(mutationTimestamp) + 10 * 60_000).toISOString(),
          knowledgeSpaceId,
          requiredAccess: "admin",
          subject,
        });
      } catch (error) {
        if (
          error instanceof KnowledgeSpaceAuthorizationError ||
          error instanceof KnowledgeSpaceAccessError
        ) {
          return context.json({ code: error.code, error: "Knowledge space access denied" }, 403);
        }
        throw error;
      }
      const updated = await manifests.update({
        expectedManifestVersion: currentManifest.manifestVersion,
        knowledgeSpaceId,
        patch: {
          manifestVersion: currentManifest.manifestVersion + 1,
          pendingModelConfiguration,
          updatedAt: mutationTimestamp,
        },
        permission: {
          fence: {
            accessChannel: permissionSnapshot.accessChannel,
            knowledgeSpaceId,
            permissionSnapshotId: permissionSnapshot.id,
            permissionSnapshotRevision: permissionSnapshot.revision,
            requestedBySubjectId: subject.subjectId,
            tenantId: subject.tenantId,
          },
          now: mutationTimestamp,
          requiredAccess: "admin",
        },
        tenantId: subject.tenantId,
      });
      if (!updated) {
        return context.json(
          {
            code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
            error: "Pending model configuration changed concurrently",
          },
          409,
        );
      }
      return context.json(
        {
          configurationStatus: "pending-validation" as const,
          digest: pendingModelConfiguration.digest,
          operation: "initial-validation-pending" as const,
          revision: pendingModelConfiguration.revision,
        },
        202,
      );
    }
    const publishedMigrationRequired =
      hasPublishedProfileTuple && profileMigrations !== undefined && profiles !== undefined;
    if (hasPublishedProfileTuple && !publishedMigrationRequired) {
      return context.json(
        {
          code: "PROFILE_MIGRATION_UNAVAILABLE",
          error: "Published retrieval profile changes require the durable migration workflow",
        },
        503,
      );
    }
    if (reasoningChanged && !publishedMigrationRequired) {
      const [usage, nodePage] = await Promise.all([
        assets.getStorageUsage({ knowledgeSpaceId }),
        nodes.listBySpace({ knowledgeSpaceId, limit: 1 }),
      ]);
      if (usage.documentCount > 0 || nodePage.items.length > 0) {
        return context.json(
          {
            code: "RETRIEVAL_PROFILE_REBUILD_REQUIRED",
            error: "Reasoning model change requires a PageIndex rebuild workflow",
          },
          409,
        );
      }
    }
    let capabilitySnapshots: Awaited<ReturnType<typeof preflightKnowledgeSpaceModels>>;
    try {
      capabilitySnapshots = await preflightKnowledgeSpaceModels({
        preflight: modelCapabilityPreflight,
        required: true,
        retrievalProfile: body.profile,
        tenantId: subject.tenantId,
      });
    } catch (error) {
      if (error instanceof ModelCapabilityPreflightError) {
        return context.json(
          { code: error.code, error: error.message },
          error.retryable ? 503 : 422,
        );
      }
      throw error;
    }

    if (publishedMigrationRequired && profileMigrations && profiles) {
      try {
        await ensureLegacyPublishedProfileTuple({
          createdBySubjectId: subject.subjectId,
          knowledgeSpaceId,
          manifest: currentManifest,
          modelCapabilityPreflight,
          now,
          profilePublicationBindings,
          profiles,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (error instanceof ModelCapabilityPreflightError) {
          return context.json(
            { code: error.code, error: error.message },
            error.retryable ? 503 : 422,
          );
        }
        if (error instanceof LegacyProfileBootstrapError) {
          return context.json({ code: error.code, error: error.message }, error.status);
        }
        if (error instanceof SettingsProfileCandidateConflictError) {
          return context.json({ code: error.code, error: error.message }, 409);
        }
        return context.json(
          {
            code: "PROFILE_PUBLICATION_BOOTSTRAP_FAILED",
            error: "Published projection tuple could not be bound to verified active profiles",
          },
          503,
        );
      }
      const activeHead = await profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId,
        tenantId: subject.tenantId,
      });
      if (!activeHead) {
        throw new Error("Bootstrapped retrieval profile head could not be reloaded");
      }
      const actualRevision = activeHead.activeRevision;
      if (actualRevision !== body.expectedRevision) {
        return context.json(
          {
            error: `Knowledge space retrieval profile revision conflict: expected=${body.expectedRevision} actual=${actualRevision}`,
          },
          409,
        );
      }
      const candidateSnapshot = createKnowledgeSpaceRetrievalProfile(
        body.profile,
        actualRevision + 1,
      );
      const capabilitySnapshot = {
        reasoning: capabilitySnapshots.reasoning ?? null,
        rerank: capabilitySnapshots.rerank ?? null,
        verification: "verified",
      } as const;
      let candidate: KnowledgeSpaceProfileRevision;
      try {
        candidate = await getOrCreateSettingsProfileCandidate(profiles, {
          capabilitySnapshot,
          createdBySubjectId: subject.subjectId,
          kind: "retrieval",
          knowledgeSpaceId,
          now: now(),
          snapshot: candidateSnapshot,
          tenantId: subject.tenantId,
        });
      } catch (error) {
        if (error instanceof SettingsProfileCandidateConflictError) {
          return context.json({ code: error.code, error: error.message }, 409);
        }
        throw error;
      }
      const authenticatedApiKey = context.get("authenticatedApiKey");
      const migration = await profileMigrations.request({
        ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
        callerKind: context.get("callerKind") ?? "interactive",
        candidateRevision: candidate.revision,
        changedKind: "retrieval",
        idempotencyKey: `settings-retrieval-${candidate.snapshotDigest}`,
        knowledgeSpaceId,
        subject,
      });
      return context.json(toPublicKnowledgeSpaceProfileMigration(migration), 202);
    }

    if (!authorization || !unpublishedProfileActivations) {
      return context.json(
        {
          code: "UNPUBLISHED_PROFILE_ACTIVATION_UNAVAILABLE",
          error: "Atomic unpublished profile activation is unavailable",
        },
        503,
      );
    }
    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const profile = createKnowledgeSpaceRetrievalProfile(body.profile, body.expectedRevision + 1);
    try {
      const mutationTimestamp = now();
      const authenticatedApiKey = context.get("authenticatedApiKey");
      const permissionSnapshot = await issueKnowledgeSpaceDurablePermission({
        access,
        ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
        authorization,
        callerKind: context.get("callerKind") ?? "interactive",
        expiresAt: new Date(Date.parse(mutationTimestamp) + 10 * 60_000).toISOString(),
        knowledgeSpaceId,
        requiredAccess: "admin",
        subject,
      });
      await unpublishedProfileActivations.activate({
        capabilitySnapshot: {
          reasoning: capabilitySnapshots.reasoning ?? null,
          rerank: capabilitySnapshots.rerank ?? null,
          verification: "verified",
        },
        createdBySubjectId: subject.subjectId,
        expectedManifestProfileRevision: body.expectedRevision,
        expectedManifestVersion: manifest.manifestVersion,
        kind: "retrieval",
        knowledgeSpaceId,
        now: mutationTimestamp,
        permission: {
          accessChannel: permissionSnapshot.accessChannel,
          knowledgeSpaceId,
          permissionSnapshotId: permissionSnapshot.id,
          permissionSnapshotRevision: permissionSnapshot.revision,
          requestedBySubjectId: subject.subjectId,
          tenantId: subject.tenantId,
        },
        snapshot: profile,
        tenantId: subject.tenantId,
      });

      return context.json(profile, 200);
    } catch (error) {
      if (error instanceof KnowledgeSpaceUnpublishedProfileActivationError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      if (error instanceof KnowledgeSpaceProfileTransitionError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }
      if (
        error instanceof KnowledgeSpaceAuthorizationError ||
        error instanceof KnowledgeSpaceAccessError
      ) {
        return context.json({ code: error.code, error: "Knowledge space access denied" }, 403);
      }

      throw error;
    }
  });

  app.openapi(getKnowledgeSpaceStatusRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const generatedAt = now();
    const projectionVersion = projectionVersionFromManifest(manifest.projectionSetVersion);
    const [
      configuration,
      storageHealthy,
      activeSessions,
      activeLeases,
      retryableCommits,
      terminalCommits,
    ] = await Promise.all([
      resolveKnowledgeSpaceConfigurationStatus({
        knowledgeSpaceId: params.id,
        manifest,
        profiles,
        tenantId: subject.tenantId,
      }),
      safeObjectStorageHealth(adapter),
      knowledgeFsSessions.listActive({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        now: generatedAt,
        tenantId: subject.tenantId,
      }),
      knowledgeFsLeases.listActive({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        now: generatedAt,
        tenantId: subject.tenantId,
      }),
      stagedCommits.list({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        status: "failed-retryable",
        tenantId: subject.tenantId,
      }),
      stagedCommits.list({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        status: "failed-terminal",
        tenantId: subject.tenantId,
      }),
    ]);
    const projectionSummaries = await summarizeProjectionStatus({
      knowledgeSpaceId: params.id,
      projectionVersion,
      projections,
    });
    const failedCommitItems = [...retryableCommits.items, ...terminalCommits.items]
      .filter(isFailedCommitDiagnostic)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, STATUS_ITEM_LIMIT);

    return context.json(
      {
        activeLeases: {
          count: activeLeases.items.length,
          items: activeLeases.items.map((lease) => ({
            expiresAt: lease.expiresAt,
            id: lease.id,
            leaseType: lease.leaseType,
            targetType: lease.targetType,
            virtualPath: lease.virtualPath,
          })),
          truncated: Boolean(activeLeases.nextCursor),
        },
        activeSessions: {
          count: activeSessions.items.length,
          items: activeSessions.items.map((session) => ({
            clientKind: session.clientKind,
            consistencyClass: session.consistencyClass,
            expiresAt: session.expiresAt,
            heartbeatAt: session.heartbeatAt,
            id: session.id,
            subjectId: session.subject.subjectId,
          })),
          truncated: Boolean(activeSessions.nextCursor),
        },
        configuration,
        failedCommits: {
          count: failedCommitItems.length,
          items: failedCommitItems.map((commit) => ({
            ...(commit.errorCode ? { errorCode: commit.errorCode } : {}),
            ...(commit.expiresAt ? { expiresAt: commit.expiresAt } : {}),
            id: commit.id,
            status: commit.status,
            updatedAt: commit.updatedAt,
          })),
          truncated:
            Boolean(retryableCommits.nextCursor) ||
            Boolean(terminalCommits.nextCursor) ||
            retryableCommits.items.length + terminalCommits.items.length > STATUS_ITEM_LIMIT,
        },
        generatedAt,
        index: {
          nodeSchemaVersion: manifest.nodeSchemaVersion,
          projectionSetVersion: manifest.projectionSetVersion,
          projectionVersion,
          summaries: projectionSummaries,
        },
        knowledgeSpaceId: params.id,
        manifest: {
          consistencyClass: manifest.consistencyPolicy.defaultClass,
          manifestVersion: manifest.manifestVersion,
          metadataDialect: manifest.metadataDialect,
          objectKeyPrefix: manifest.objectKeyPrefix,
          storageProvider: manifest.storageProvider,
        },
        parser: {
          kind: parser.kind,
          policyVersion: manifest.parserPolicyVersion,
        },
        storage: {
          healthy: storageHealthy,
          objectStorageKind: adapter.objectStorage.kind,
          provider: manifest.storageProvider,
        },
        tenantId: subject.tenantId,
      },
      200,
    );
  });

  app.openapi(getKnowledgeSpaceStatsRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const generatedAt = now();
    const windowStart = subtractMinutes(generatedAt, query.windowMinutes);
    const projectionVersion = projectionVersionFromManifest(manifest.projectionSetVersion);
    const [
      storageUsage,
      cacheStats,
      activeSessions,
      activeLeases,
      retryableCommits,
      terminalCommits,
      projectionSummaries,
    ] = await Promise.all([
      assets.getStorageUsage({ knowledgeSpaceId: params.id }),
      safeCacheStats(adapter),
      knowledgeFsSessions.listActive({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        now: generatedAt,
        tenantId: subject.tenantId,
      }),
      knowledgeFsLeases.listActive({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        now: generatedAt,
        tenantId: subject.tenantId,
      }),
      stagedCommits.list({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        status: "failed-retryable",
        tenantId: subject.tenantId,
      }),
      stagedCommits.list({
        knowledgeSpaceId: params.id,
        limit: STATUS_ITEM_LIMIT,
        status: "failed-terminal",
        tenantId: subject.tenantId,
      }),
      summarizeProjectionStatus({
        knowledgeSpaceId: params.id,
        projectionVersion,
        projections,
      }),
    ]);
    const retryableInWindow = retryableCommits.items.filter(
      (commit) => commit.updatedAt >= windowStart && commit.updatedAt <= generatedAt,
    );
    const terminalInWindow = terminalCommits.items.filter(
      (commit) => commit.updatedAt >= windowStart && commit.updatedAt <= generatedAt,
    );

    return context.json(
      {
        cache: cacheStats,
        commits: {
          failedRetryable: retryableInWindow.length,
          failedTerminal: terminalInWindow.length,
          sampled: retryableCommits.items.length + terminalCommits.items.length,
          truncated: Boolean(retryableCommits.nextCursor) || Boolean(terminalCommits.nextCursor),
        },
        generatedAt,
        knowledgeSpaceId: params.id,
        metrics: {
          available: false,
          reason: "metrics-backend-not-configured",
        },
        projections: {
          ...projectionSummaries,
          projectionVersion,
        },
        runtime: {
          activeLeaseSampleCount: activeLeases.items.length,
          activeSessionSampleCount: activeSessions.items.length,
          truncated: Boolean(activeSessions.nextCursor) || Boolean(activeLeases.nextCursor),
        },
        storage: storageUsage,
        tenantId: subject.tenantId,
        window: {
          end: generatedAt,
          minutes: query.windowMinutes,
          start: windowStart,
        },
      },
      200,
    );
  });

  app.openapi(getKnowledgeSpaceFsckRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const input = {
      ...(query.cursor ? { cursor: query.cursor } : {}),
      knowledgeSpaceId: params.id,
      tenantId: subject.tenantId,
    };

    if (query.check === "artifact-segments") {
      const checker = createKnowledgeFsArtifactSegmentFsckChecker({
        artifactSegments,
        assets,
        maxAssetsPerRun: OPERATOR_PAGE_LIMIT,
        maxSegmentsPerArtifact: OPERATOR_PAGE_LIMIT,
        now,
        objectStorage: adapter.objectStorage,
        parseArtifacts,
      });

      return context.json(await checker.check(input), 200);
    }

    if (query.check === "references") {
      const checker = createKnowledgeFsReferenceFsckChecker({
        assets,
        maxNodesPerRun: OPERATOR_PAGE_LIMIT,
        maxPathsPerView: OPERATOR_PAGE_LIMIT,
        maxProjectionsPerType: OPERATOR_PAGE_LIMIT,
        nodes,
        now,
        parseArtifacts,
        paths,
        pathViewNames: ["physical"],
        projections,
        projectionTypes: ["dense-vector", "fts", "metadata", "graph"],
      });

      return context.json(await checker.check(input), 200);
    }

    const checker = createKnowledgeFsRawObjectFsckChecker({
      assets,
      maxAssetsPerRun: OPERATOR_PAGE_LIMIT,
      now,
      objectStorage: adapter.objectStorage,
    });

    return context.json(await checker.check(input), 200);
  });

  app.openapi(getKnowledgeSpaceStagedObjectGcDryRunRoute, async (context) => {
    const subject = context.get("subject");
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const space = await spaces.get({
      id: params.id,
      tenantId: subject.tenantId,
    });

    if (!space) {
      return context.json({ error: "Knowledge space not found" }, 404);
    }

    const manifest = await ensureKnowledgeSpaceManifest({
      generateId: generateManifestId,
      manifests,
      now,
      space,
    });
    const dryRun = createKnowledgeFsStagedObjectGcDryRun({
      commits: stagedCommits,
      generateDryRunId: generateGcDryRunId,
      maxFailedCommitsPerRun: OPERATOR_PAGE_LIMIT,
      maxObjectsPerRun: OPERATOR_PAGE_LIMIT,
      now,
      objectStorage: adapter.objectStorage,
    });

    return context.json(
      await dryRun.preview({
        ...(query.cursor ? { cursor: query.cursor } : {}),
        knowledgeSpaceId: params.id,
        stagedObjectPrefix: query.stagedObjectPrefix ?? `${manifest.objectKeyPrefix}/staging/`,
        tenantId: subject.tenantId,
      }),
      200,
    );
  });

  app.openapi(executeKnowledgeSpaceStagedObjectGcRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const body = context.req.valid("json");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      const executor = createKnowledgeFsStagedObjectGcExecutor({
        maxDeletes: OPERATOR_PAGE_LIMIT,
        objectStorage: adapter.objectStorage,
        operationLeases,
      });

      const result = await executor.execute({
        candidates: body.candidates,
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
      });

      return context.json(
        {
          deleted: result.deleted,
          items: result.items.map((item) => ({ ...item })),
          skipped: result.skipped,
          tenantId: result.tenantId,
        },
        200,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("maxDeletes")) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected staged object GC failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(listKnowledgeSpaceActiveLeasesRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      const result = await knowledgeFsLeases.listActive({
        ...context.req.valid("query"),
        knowledgeSpaceId: params.id,
        now: now(),
        tenantId: subject.tenantId,
      });

      return context.json(
        {
          items: result.items.map((lease) => ({ ...lease })),
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
        200,
      );
    } catch (error) {
      if (error instanceof KnowledgeFsLeaseListLimitExceededError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected active lease list failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(listKnowledgeSpaceStagedCommitsRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const params = context.req.valid("param");
      const space = await spaces.get({
        id: params.id,
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      const result = await stagedCommits.list({
        ...context.req.valid("query"),
        knowledgeSpaceId: params.id,
        tenantId: subject.tenantId,
      });

      return context.json(result, 200);
    } catch (error) {
      if (error instanceof StagedCommitListLimitExceededError) {
        return context.json({ error: error.message }, 400);
      }

      /* v8 ignore next 2 -- unexpected staged commit list failures should escape to Hono. */
      throw error;
    }
  });

  app.openapi(updateKnowledgeSpaceRoute, async (context) => {
    try {
      const subject = context.get("subject");
      const mutationTimestamp = now();
      const authenticatedApiKey = context.get("authenticatedApiKey");
      const permissionSnapshot = authorization
        ? await issueKnowledgeSpaceDurablePermission({
            access,
            ...(authenticatedApiKey ? { apiKey: authenticatedApiKey } : {}),
            authorization,
            callerKind: context.get("callerKind") ?? "interactive",
            expiresAt: new Date(Date.parse(mutationTimestamp) + 10 * 60_000).toISOString(),
            knowledgeSpaceId: context.req.valid("param").id,
            requiredAccess: "write",
            subject,
          })
        : undefined;
      const space = await spaces.update({
        ...context.req.valid("json"),
        actorSubjectId: subject.subjectId,
        id: context.req.valid("param").id,
        ...(permissionSnapshot
          ? {
              permission: {
                fence: {
                  accessChannel: permissionSnapshot.accessChannel,
                  knowledgeSpaceId: context.req.valid("param").id,
                  permissionSnapshotId: permissionSnapshot.id,
                  permissionSnapshotRevision: permissionSnapshot.revision,
                  requestedBySubjectId: subject.subjectId,
                  tenantId: subject.tenantId,
                },
                now: mutationTimestamp,
                requiredAccess: "write" as const,
              },
            }
          : {}),
        tenantId: subject.tenantId,
      });

      if (!space) {
        return context.json({ error: "Knowledge space not found" }, 404);
      }

      return context.json(space, 200);
    } catch (error) {
      if (error instanceof DuplicateKnowledgeSpaceSlugError) {
        return context.json({ error: error.message }, 409);
      }

      if (error instanceof KnowledgeSpaceRevisionConflictError) {
        return context.json({ code: error.code, error: error.message }, 409);
      }

      if (
        error instanceof KnowledgeSpaceAuthorizationError ||
        error instanceof KnowledgeSpaceAccessError
      ) {
        return context.json({ code: error.code, error: "Knowledge space access denied" }, 403);
      }

      /* v8 ignore next 2 -- unexpected knowledge-space update failures should escape to Hono. */
      throw error;
    }
  });
}

function toProductSettings(manifest: KnowledgeSpaceManifest) {
  const pending = manifest.pendingModelConfiguration;
  const embedding = pending?.embeddingSelection ?? manifest.embeddingProfile ?? null;
  const retrieval = pending?.retrievalProfile ?? manifest.retrievalProfile ?? null;
  const configurationState = pending
    ? pending.state
    : embedding || retrieval
      ? ("active" as const)
      : ("setup-required" as const);
  return {
    configurationState,
    embedding,
    retrieval,
    revision: manifest.manifestVersion,
  };
}

async function preflightKnowledgeSpaceModels({
  embedding,
  preflight,
  required = false,
  retrievalProfile,
  tenantId,
}: {
  readonly embedding?: KnowledgeSpaceEmbeddingSelection | undefined;
  readonly preflight?: ModelCapabilityPreflight | undefined;
  readonly required?: boolean | undefined;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfileInput | undefined;
  readonly tenantId: string;
}): Promise<{
  readonly embedding?: ModelCapabilitySnapshot | undefined;
  readonly reasoning?: ModelCapabilitySnapshot | undefined;
  readonly rerank?: ModelCapabilitySnapshot | undefined;
}> {
  if (!preflight && required) {
    throw new ModelCapabilityPreflightError(
      "MODEL_PREFLIGHT_UNAVAILABLE",
      "Model capability preflight is unavailable",
      { retryable: true },
    );
  }
  if (!preflight) {
    return {};
  }
  const [embeddingSnapshot, reasoningSnapshot, rerankSnapshot] = await Promise.all([
    embedding ? preflight.verify({ kind: "embedding", selection: embedding, tenantId }) : undefined,
    retrievalProfile
      ? preflight.verify({
          kind: "reasoning",
          selection: retrievalProfile.reasoningModel,
          tenantId,
        })
      : undefined,
    retrievalProfile?.rerank.enabled && retrievalProfile.rerank.model
      ? preflight.verify({
          kind: "rerank",
          selection: retrievalProfile.rerank.model,
          tenantId,
        })
      : undefined,
  ]);
  return {
    ...(embeddingSnapshot ? { embedding: embeddingSnapshot } : {}),
    ...(reasoningSnapshot ? { reasoning: reasoningSnapshot } : {}),
    ...(rerankSnapshot ? { rerank: rerankSnapshot } : {}),
  };
}

function embeddingVectorSpaceIdentityFromSnapshot(snapshot: ModelCapabilitySnapshot) {
  if (
    snapshot.kind !== "embedding" ||
    snapshot.dimension === undefined ||
    !snapshot.distanceMetric
  ) {
    throw new ModelCapabilityPreflightError(
      "MODEL_CAPABILITY_MISMATCH",
      "The embedding model did not declare a usable distance metric",
    );
  }
  return {
    capabilityDigest: snapshot.capabilityDigest,
    dimension: snapshot.dimension,
    distanceMetric: snapshot.distanceMetric,
    pluginUniqueIdentifier: snapshot.pluginUniqueIdentifier,
    schemaFingerprint: snapshot.schemaFingerprint,
  };
}

class LegacyProfileBootstrapError extends Error {
  readonly code: string;
  readonly status: 409 | 503;

  constructor(code: string, message: string, status: 409 | 503) {
    super(message);
    this.name = "LegacyProfileBootstrapError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Reconciles a pre-versioned published space without ever activating an unverified model profile.
 * Every missing legacy model is probed first; only after all probes pass are immutable candidates
 * staged and activated. The current publication is then bound to the exact verified heads.
 */
export async function ensureLegacyPublishedProfileTuple({
  createdBySubjectId,
  knowledgeSpaceId,
  manifest,
  modelCapabilityPreflight,
  now,
  profilePublicationBindings,
  profiles,
  tenantId,
}: {
  readonly createdBySubjectId: string;
  readonly knowledgeSpaceId: string;
  readonly manifest: KnowledgeSpaceManifest | null | undefined;
  readonly modelCapabilityPreflight: ModelCapabilityPreflight | undefined;
  readonly now: () => string;
  readonly profilePublicationBindings:
    | Pick<KnowledgeSpaceProfilePublicationRepository, "bindCurrentPublished">
    | undefined;
  readonly profiles: KnowledgeSpaceProfileRepository;
  readonly tenantId: string;
}): Promise<void> {
  if (!profilePublicationBindings) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_UNAVAILABLE",
      "Legacy published profile bootstrap is unavailable",
      503,
    );
  }
  if (!manifest?.retrievalProfile) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_MIGRATION_BASE_PROFILE_MISSING",
      "Legacy published space has no retrieval profile to bootstrap",
      409,
    );
  }

  const scope = { knowledgeSpaceId, tenantId };
  const [embeddingHead, retrievalHead] = await Promise.all([
    profiles.getHead({ ...scope, kind: "embedding" }),
    profiles.getHead({ ...scope, kind: "retrieval" }),
  ]);
  if (embeddingHead && !verifiedProfileCapability(embeddingHead.profile)) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED",
      "Existing embedding profile head is not backed by a verified model capability",
      409,
    );
  }
  if (embeddingHead) {
    await verifyLegacyEmbeddingProfile(
      embeddingHead.profile.snapshot as KnowledgeSpaceEmbeddingProfile,
      ModelCapabilitySnapshotSchema.parse(embeddingHead.profile.capabilitySnapshot),
    );
  }
  if (retrievalHead && !verifiedProfileCapability(retrievalHead.profile)) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED",
      "Existing retrieval profile head is not backed by verified model capabilities",
      409,
    );
  }

  const missingEmbedding = !embeddingHead && manifest.embeddingProfile;
  const missingRetrieval = !retrievalHead ? manifest.retrievalProfile : undefined;
  if (
    !embeddingHead &&
    !manifest.embeddingProfile &&
    manifest.retrievalProfile.defaultMode !== "research"
  ) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_MIGRATION_BASE_PROFILE_MISSING",
      "Fast/Deep legacy publication has no embedding profile to bootstrap",
      409,
    );
  }

  if (missingEmbedding || missingRetrieval) {
    const capabilitySnapshots = await preflightKnowledgeSpaceModels({
      ...(missingEmbedding ? { embedding: missingEmbedding } : {}),
      preflight: modelCapabilityPreflight,
      required: true,
      ...(missingRetrieval ? { retrievalProfile: missingRetrieval } : {}),
      tenantId,
    });
    const candidates: KnowledgeSpaceProfileRevision[] = [];
    if (missingEmbedding) {
      const capability = capabilitySnapshots.embedding;
      if (!capability) {
        throw new ModelCapabilityPreflightError(
          "MODEL_PREFLIGHT_UNAVAILABLE",
          "Legacy embedding capability preflight is unavailable",
          { retryable: true },
        );
      }
      const verifiedSnapshot = await verifyLegacyEmbeddingProfile(missingEmbedding, capability);
      candidates.push(
        await getOrCreateLegacyProfileCandidate(profiles, {
          capabilitySnapshot: capability,
          createdBySubjectId,
          kind: "embedding",
          knowledgeSpaceId,
          now: now(),
          preserveLegacyInitialRevision: true,
          snapshot: verifiedSnapshot,
          tenantId,
        }),
      );
    }
    if (missingRetrieval) {
      const reasoning = capabilitySnapshots.reasoning;
      if (!reasoning) {
        throw new ModelCapabilityPreflightError(
          "MODEL_PREFLIGHT_UNAVAILABLE",
          "Legacy reasoning capability preflight is unavailable",
          { retryable: true },
        );
      }
      candidates.push(
        await getOrCreateLegacyProfileCandidate(profiles, {
          capabilitySnapshot: {
            reasoning,
            rerank: capabilitySnapshots.rerank ?? null,
            verification: "verified",
          },
          createdBySubjectId,
          kind: "retrieval",
          knowledgeSpaceId,
          now: now(),
          preserveLegacyInitialRevision: true,
          snapshot: missingRetrieval,
          tenantId,
        }),
      );
    }
    for (const candidate of candidates) {
      try {
        await profiles.activateCandidate({
          expectedActiveRevision: null,
          kind: candidate.kind,
          knowledgeSpaceId,
          now: now(),
          revision: candidate.revision,
          tenantId,
        });
      } catch (error) {
        const raced = await profiles.getHead({ kind: candidate.kind, ...scope });
        if (
          !raced ||
          raced.profile.snapshotDigest !== candidate.snapshotDigest ||
          raced.profile.capabilitySnapshotDigest !== candidate.capabilitySnapshotDigest
        ) {
          throw error;
        }
      }
    }
  }

  await profilePublicationBindings.bindCurrentPublished({
    knowledgeSpaceId,
    tenantId,
    verifiedAt: now(),
  });
}

async function getOrCreateLegacyProfileCandidate(
  profiles: KnowledgeSpaceProfileRepository,
  input: Parameters<KnowledgeSpaceProfileRepository["createCandidate"]>[0],
): Promise<KnowledgeSpaceProfileRevision> {
  const expectedSnapshotDigest = knowledgeSpaceProfileSnapshotDigest(input.snapshot);
  const lookup = async () => {
    const existing = await profiles.getRevision({
      kind: input.kind,
      knowledgeSpaceId: input.knowledgeSpaceId,
      revision: input.snapshot.revision,
      tenantId: input.tenantId,
    });
    if (
      existing?.state === "candidate" &&
      existing.snapshotDigest === expectedSnapshotDigest &&
      equivalentLegacyCapabilitySnapshot(
        input.kind,
        existing.capabilitySnapshot,
        input.capabilitySnapshot,
      )
    ) {
      return existing;
    }
    if (existing) throw new SettingsProfileCandidateConflictError();
    return null;
  };
  const replay = await lookup();
  if (replay) return replay;
  try {
    return await profiles.createCandidate(input);
  } catch (error) {
    if (
      error instanceof KnowledgeSpaceProfileTransitionError &&
      (error.code === "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS" ||
        error.code === "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT")
    ) {
      const concurrent = await lookup();
      if (concurrent) return concurrent;
      throw new SettingsProfileCandidateConflictError();
    }
    throw error;
  }
}

function equivalentLegacyCapabilitySnapshot(
  kind: "embedding" | "retrieval",
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  if (kind === "embedding") {
    const leftEmbedding = ModelCapabilitySnapshotSchema.safeParse(left);
    const rightEmbedding = ModelCapabilitySnapshotSchema.safeParse(right);
    return Boolean(
      leftEmbedding.success &&
        rightEmbedding.success &&
        leftEmbedding.data.kind === "embedding" &&
        rightEmbedding.data.kind === "embedding" &&
        leftEmbedding.data.capabilityDigest === rightEmbedding.data.capabilityDigest,
    );
  }
  if (left.verification !== "verified" || right.verification !== "verified") return false;
  const leftReasoning = ModelCapabilitySnapshotSchema.safeParse(left.reasoning);
  const rightReasoning = ModelCapabilitySnapshotSchema.safeParse(right.reasoning);
  if (
    !leftReasoning.success ||
    !rightReasoning.success ||
    leftReasoning.data.kind !== "reasoning" ||
    rightReasoning.data.kind !== "reasoning" ||
    leftReasoning.data.capabilityDigest !== rightReasoning.data.capabilityDigest
  ) {
    return false;
  }
  if (left.rerank === null || right.rerank === null) return left.rerank === right.rerank;
  const leftRerank = ModelCapabilitySnapshotSchema.safeParse(left.rerank);
  const rightRerank = ModelCapabilitySnapshotSchema.safeParse(right.rerank);
  return Boolean(
    leftRerank.success &&
      rightRerank.success &&
      leftRerank.data.kind === "rerank" &&
      rightRerank.data.kind === "rerank" &&
      leftRerank.data.capabilityDigest === rightRerank.data.capabilityDigest,
  );
}

async function verifyLegacyEmbeddingProfile(
  snapshot: KnowledgeSpaceEmbeddingProfile,
  capability: ModelCapabilitySnapshot,
): Promise<KnowledgeSpaceEmbeddingProfile> {
  if (
    capability.kind !== "embedding" ||
    capability.dimension === undefined ||
    !capability.distanceMetric ||
    !sameModelSelection(capability.selection, snapshot)
  ) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_CAPABILITY_MISMATCH",
      "Legacy embedding capability does not match its frozen model selection",
      409,
    );
  }
  const selection = {
    model: snapshot.model,
    pluginId: snapshot.pluginId,
    provider: snapshot.provider,
  };
  const [legacyVectorSpaceId, capabilityBoundVectorSpaceId] = await Promise.all([
    buildKnowledgeSpaceVectorSpaceId(selection, snapshot.revision),
    buildKnowledgeSpaceVectorSpaceId(selection, snapshot.revision, {
      capabilityDigest: capability.capabilityDigest,
      dimension: capability.dimension,
      distanceMetric: capability.distanceMetric,
      pluginUniqueIdentifier: capability.pluginUniqueIdentifier,
      schemaFingerprint: capability.schemaFingerprint,
    }),
  ]);
  if (
    snapshot.vectorSpaceId !== legacyVectorSpaceId &&
    snapshot.vectorSpaceId !== capabilityBoundVectorSpaceId
  ) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_VECTOR_SPACE_UNPROVEN",
      "Legacy embedding vector-space identity is not proven by the installed model capability",
      409,
    );
  }
  if (snapshot.dimension !== undefined && snapshot.dimension !== capability.dimension) {
    throw new LegacyProfileBootstrapError(
      "PROFILE_PUBLICATION_BOOTSTRAP_DIMENSION_CONFLICT",
      "Legacy embedding dimension conflicts with the observed model dimension",
      409,
    );
  }
  return KnowledgeSpaceEmbeddingProfileSchema.parse({
    ...snapshot,
    dimension: capability.dimension,
  });
}

function verifiedProfileCapability(profile: KnowledgeSpaceProfileRevision): boolean {
  if (profile.kind === "embedding") {
    const snapshot = profile.snapshot as KnowledgeSpaceEmbeddingProfile;
    const capability = ModelCapabilitySnapshotSchema.safeParse(profile.capabilitySnapshot);
    return Boolean(
      capability.success &&
        capability.data.kind === "embedding" &&
        snapshot.dimension !== undefined &&
        capability.data.dimension === snapshot.dimension &&
        sameModelSelection(capability.data.selection, snapshot),
    );
  }
  const snapshot = profile.snapshot as KnowledgeSpaceRetrievalProfile;
  if (profile.capabilitySnapshot.verification !== "verified") return false;
  const reasoning = ModelCapabilitySnapshotSchema.safeParse(profile.capabilitySnapshot.reasoning);
  if (
    !reasoning.success ||
    reasoning.data.kind !== "reasoning" ||
    !sameModelSelection(reasoning.data.selection, snapshot.reasoningModel)
  ) {
    return false;
  }
  if (!snapshot.rerank.enabled) return profile.capabilitySnapshot.rerank === null;
  if (!snapshot.rerank.model) return false;
  const rerank = ModelCapabilitySnapshotSchema.safeParse(profile.capabilitySnapshot.rerank);
  return Boolean(
    rerank.success &&
      rerank.data.kind === "rerank" &&
      sameModelSelection(rerank.data.selection, snapshot.rerank.model),
  );
}

function sameModelSelection(
  left: { readonly model: string; readonly pluginId: string; readonly provider: string },
  right: { readonly model: string; readonly pluginId: string; readonly provider: string },
): boolean {
  return (
    left.model === right.model &&
    left.pluginId === right.pluginId &&
    left.provider === right.provider
  );
}

class SettingsProfileCandidateConflictError extends Error {
  readonly code = "KNOWLEDGE_SPACE_SETTINGS_CANDIDATE_CONFLICT";

  constructor() {
    super("Another settings update already owns the next immutable profile revision");
    this.name = "SettingsProfileCandidateConflictError";
  }
}

/**
 * Candidate allocation happens before the migration request ledger is written. Re-reading the
 * exact immutable revision makes a client retry safe after a response disconnect, while refusing
 * to attach a different settings request to somebody else's pending candidate.
 */
async function getOrCreateSettingsProfileCandidate(
  profiles: KnowledgeSpaceProfileRepository,
  input: Parameters<KnowledgeSpaceProfileRepository["createCandidate"]>[0],
): Promise<KnowledgeSpaceProfileRevision> {
  const expectedSnapshotDigest = knowledgeSpaceProfileSnapshotDigest(input.snapshot);
  const expectedCapabilityDigest = knowledgeSpaceProfileSnapshotDigest(input.capabilitySnapshot);
  const lookup = async () => {
    const existing = await profiles.getRevision({
      kind: input.kind,
      knowledgeSpaceId: input.knowledgeSpaceId,
      revision: input.snapshot.revision,
      tenantId: input.tenantId,
    });
    if (!existing) return null;
    if (
      existing.state === "candidate" &&
      existing.snapshotDigest === expectedSnapshotDigest &&
      existing.capabilitySnapshotDigest === expectedCapabilityDigest &&
      existing.createdBySubjectId === input.createdBySubjectId
    ) {
      return existing;
    }
    throw new SettingsProfileCandidateConflictError();
  };

  const replay = await lookup();
  if (replay) return replay;
  try {
    return await profiles.createCandidate(input);
  } catch (error) {
    if (
      error instanceof KnowledgeSpaceProfileTransitionError &&
      (error.code === "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS" ||
        error.code === "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT")
    ) {
      const concurrentReplay = await lookup();
      if (concurrentReplay) return concurrentReplay;
      throw new SettingsProfileCandidateConflictError();
    }
    throw error;
  }
}

const STATUS_ITEM_LIMIT = 10;
const OPERATOR_PAGE_LIMIT = 100;

type PublicKnowledgeSpaceConfigurationStatus =
  | "setup-required"
  | "pending-validation"
  | "validation-failed"
  | "ready";

type PublicPendingModelConfiguration = {
  readonly digest: string;
  readonly revision: number;
} & (
  | { readonly state: "pending-validation" }
  | {
      readonly failure: {
        readonly code: string;
        readonly failedAt: string;
        readonly retryable: boolean;
      };
      readonly state: "validation-failed";
    }
);

/**
 * Produces the operator-facing configuration state from durable active heads plus the candidate
 * marker. Active heads remain authoritative while an update is pending or failed: a bad candidate
 * must not make an already-queryable space appear unavailable. Candidate selections and raw
 * provider failure messages are deliberately excluded from this diagnostics response.
 */
async function resolveKnowledgeSpaceConfigurationStatus({
  knowledgeSpaceId,
  manifest,
  profiles,
  tenantId,
}: {
  readonly knowledgeSpaceId: string;
  readonly manifest: KnowledgeSpaceManifest;
  readonly profiles: KnowledgeSpaceProfileRepository | undefined;
  readonly tenantId: string;
}): Promise<{
  readonly activeProfiles: {
    readonly embeddingRevision?: number | undefined;
    readonly retrievalRevision?: number | undefined;
  };
  readonly availableModes: ("deep" | "fast" | "research")[];
  readonly pendingModelConfiguration?: PublicPendingModelConfiguration | undefined;
  readonly status: PublicKnowledgeSpaceConfigurationStatus;
}> {
  const [embeddingHead, retrievalHead] = profiles
    ? await Promise.all([
        profiles.getHead({ kind: "embedding", knowledgeSpaceId, tenantId }),
        profiles.getHead({ kind: "retrieval", knowledgeSpaceId, tenantId }),
      ])
    : [null, null];
  const embeddingProfile = profiles
    ? KnowledgeSpaceEmbeddingProfileSchema.safeParse(embeddingHead?.profile.snapshot).data
    : manifest.embeddingProfile;
  const retrievalProfile = profiles
    ? KnowledgeSpaceRetrievalProfileSchema.safeParse(retrievalHead?.profile.snapshot).data
    : manifest.retrievalProfile;
  const activeReady = Boolean(
    retrievalProfile && (retrievalProfile.defaultMode === "research" || embeddingProfile),
  );
  const pendingResult = readPendingModelConfiguration(manifest);
  const pendingModelConfiguration =
    pendingResult.kind === "valid" ? pendingResult.configuration : undefined;
  const status: PublicKnowledgeSpaceConfigurationStatus = activeReady
    ? "ready"
    : pendingResult.kind === "invalid" || pendingModelConfiguration?.state === "validation-failed"
      ? "validation-failed"
      : pendingModelConfiguration
        ? "pending-validation"
        : "setup-required";

  return {
    activeProfiles: {
      ...(embeddingProfile ? { embeddingRevision: embeddingProfile.revision } : {}),
      ...(retrievalProfile ? { retrievalRevision: retrievalProfile.revision } : {}),
    },
    availableModes: activeReady
      ? embeddingProfile
        ? ["fast", "research", "deep"]
        : ["research"]
      : [],
    ...(pendingModelConfiguration ? { pendingModelConfiguration } : {}),
    status,
  };
}

function readPendingModelConfiguration(
  manifest: KnowledgeSpaceManifest,
):
  | { readonly kind: "absent" }
  | { readonly kind: "invalid" }
  | { readonly configuration: PublicPendingModelConfiguration; readonly kind: "valid" } {
  const extended = manifest as KnowledgeSpaceManifest & {
    readonly pendingModelConfiguration?: unknown;
  };
  const candidate =
    extended.pendingModelConfiguration ?? manifest.metadata.__knowledgeFsPendingModelConfiguration;
  if (candidate === undefined) return { kind: "absent" };
  if (!isPlainRecord(candidate)) return { kind: "invalid" };

  const revision = candidate.revision;
  const digest = candidate.digest;
  const rawState = candidate.state;
  if (
    !Number.isSafeInteger(revision) ||
    (revision as number) < 1 ||
    typeof digest !== "string" ||
    !/^(?:sha256:)?[a-f0-9]{64}$/.test(digest) ||
    (rawState !== "pending-validation" &&
      rawState !== "validating" &&
      rawState !== "validation-failed")
  ) {
    return { kind: "invalid" };
  }

  if (rawState !== "validation-failed") {
    if (candidate.failure !== undefined) return { kind: "invalid" };
    return {
      configuration: {
        digest,
        revision: revision as number,
        state: "pending-validation",
      },
      kind: "valid",
    };
  }

  if (!isPlainRecord(candidate.failure)) return { kind: "invalid" };
  const code = candidate.failure.code;
  const failedAt = candidate.failure.failedAt;
  const retryable = candidate.failure.retryable;
  if (
    typeof code !== "string" ||
    !/^[A-Za-z0-9._:-]{1,64}$/.test(code) ||
    typeof failedAt !== "string" ||
    Number.isNaN(Date.parse(failedAt)) ||
    typeof retryable !== "boolean"
  ) {
    return { kind: "invalid" };
  }
  return {
    configuration: {
      digest,
      failure: {
        code,
        failedAt: new Date(failedAt).toISOString(),
        retryable,
      },
      revision: revision as number,
      state: "validation-failed",
    },
    kind: "valid",
  };
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectionVersionFromManifest(projectionSetVersion: string): number {
  const match = /(?:^|[^0-9])v?([1-9][0-9]*)$/.exec(projectionSetVersion);

  return match ? Number(match[1]) : 1;
}

function isFailedCommitDiagnostic(
  commit: KnowledgeSpaceStagedCommit,
): commit is KnowledgeSpaceStagedCommit & {
  readonly status: "failed-retryable" | "failed-terminal";
} {
  return commit.status === "failed-retryable" || commit.status === "failed-terminal";
}

async function listAuthorizedSpacesFallback(input: {
  readonly authorization: KnowledgeSpaceAuthorizationGuard;
  readonly callerKind: KnowledgeSpaceCallerKind;
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly spaces: KnowledgeSpaceRepository;
  readonly subject: AuthSubject;
}): Promise<{ readonly items: KnowledgeSpace[]; readonly nextCursor?: string | undefined }> {
  const visible: KnowledgeSpace[] = [];
  let scanCursor = input.cursor;
  // This path exists for bounded in-memory/custom repositories. Production database repositories
  // use a membership/visibility SQL join before LIMIT instead of tenant-page-then-filter.
  for (let pageNumber = 0; pageNumber < 100 && visible.length <= input.limit; pageNumber += 1) {
    const page = await input.spaces.list({
      ...(scanCursor ? { cursor: scanCursor } : {}),
      // The custom repository has already accepted the public request limit, but may enforce a
      // lower max than the gateway's production default. Reuse that validated limit while paging
      // until we have one extra authorized result for the outward cursor.
      limit: input.limit,
      tenantId: input.subject.tenantId,
    });
    for (const space of page.items) {
      try {
        await input.authorization.authorize({
          callerKind: input.callerKind,
          knowledgeSpaceId: space.id,
          requiredAccess: "read",
          subject: input.subject,
        });
        visible.push(space);
        if (visible.length > input.limit) {
          break;
        }
      } catch (error) {
        if (!(error instanceof KnowledgeSpaceAuthorizationError)) {
          throw error;
        }
      }
    }
    if (visible.length > input.limit || !page.nextCursor) {
      break;
    }
    scanCursor = page.nextCursor;
  }
  const items = visible.slice(0, input.limit);
  const nextCursor = visible.length > input.limit ? items.at(-1)?.slug : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}) };
}

function subtractMinutes(timestamp: string, minutes: number): string {
  return new Date(new Date(timestamp).getTime() - minutes * 60_000).toISOString();
}

async function safeCacheStats(adapter: PlatformAdapter): Promise<{
  readonly available: boolean;
  readonly entries: number;
  readonly totalBytes: number;
}> {
  try {
    const stats = await adapter.cache.stats();

    return {
      available: true,
      entries: stats.entries,
      totalBytes: stats.totalBytes,
    };
  } catch {
    return {
      available: false,
      entries: 0,
      totalBytes: 0,
    };
  }
}

async function safeObjectStorageHealth(adapter: PlatformAdapter): Promise<boolean> {
  try {
    return await adapter.objectStorage.health();
  } catch {
    return false;
  }
}

async function summarizeProjectionStatus({
  knowledgeSpaceId,
  projectionVersion,
  projections,
}: {
  readonly knowledgeSpaceId: string;
  readonly projectionVersion: number;
  readonly projections: IndexProjectionRepository;
}): Promise<{
  readonly denseVector: IndexProjectionVersionSummary;
  readonly fts: IndexProjectionVersionSummary;
  readonly graph: IndexProjectionVersionSummary;
  readonly metadata: IndexProjectionVersionSummary;
}> {
  const [denseVector, fts, graph, metadata] = await Promise.all([
    projections.summarizeVersion({
      knowledgeSpaceId,
      projectionVersion,
      type: "dense-vector",
    }),
    projections.summarizeVersion({
      knowledgeSpaceId,
      projectionVersion,
      type: "fts",
    }),
    projections.summarizeVersion({
      knowledgeSpaceId,
      projectionVersion,
      type: "graph",
    }),
    projections.summarizeVersion({
      knowledgeSpaceId,
      projectionVersion,
      type: "metadata",
    }),
  ]);

  return {
    denseVector,
    fts,
    graph,
    metadata,
  };
}
