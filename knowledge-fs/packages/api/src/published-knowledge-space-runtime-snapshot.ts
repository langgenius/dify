import {
  type DatabaseAdapter,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  buildKnowledgeSpaceVectorSpaceId,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import {
  type ModelCapabilitySnapshot,
  ModelCapabilitySnapshotSchema,
} from "./model-capability-preflight";
import {
  type PublishedProjectionReadSnapshot,
  type PublishedProjectionReadSnapshotLookupInput,
  PublishedProjectionReadUnavailableError,
  type PublishedProjectionReadinessGate,
} from "./published-projection-read-snapshot";

export interface PublishedKnowledgeSpaceRuntimeSnapshot {
  readonly embeddingCapabilitySnapshot?: Readonly<Record<string, unknown>> | undefined;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly projectionSnapshot: PublishedProjectionReadSnapshot;
  readonly retrievalCapabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
}

export interface PublishedKnowledgeSpaceRuntimeSnapshotResolver {
  assertReady(input: PublishedProjectionReadSnapshotLookupInput): Promise<void>;
  resolve(input: {
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }): Promise<PublishedKnowledgeSpaceRuntimeSnapshot>;
}

/**
 * Captures publication head plus both active profile heads with one SQL statement. This is the
 * production query boundary: a concurrent settings or publication cutover can yield old+old or
 * new+new, never a mixed vector-space/publication/profile tuple.
 */
export function createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({
  database,
  readiness,
}: {
  readonly database: DatabaseAdapter;
  readonly readiness?:
    | PublishedProjectionReadinessGate
    | readonly PublishedProjectionReadinessGate[]
    | undefined;
}): PublishedKnowledgeSpaceRuntimeSnapshotResolver {
  const gates = readiness ? (Array.isArray(readiness) ? readiness : [readiness]) : [];
  return {
    assertReady: async (input) => {
      for (const gate of gates) {
        if (!(await gate.isQueryReady(input))) {
          throw new PublishedProjectionReadUnavailableError(input);
        }
      }
    },
    resolve: async (input) => {
      const p = (index: number) => databasePlaceholder(database, index);
      const q = (identifier: string) => quoteDatabaseIdentifier(database, identifier);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId],
        sql: `SELECT
          pub.${q("id")} AS ${q("publication_id")},
          pub.${q("fingerprint")} AS ${q("publication_fingerprint")},
          pub.${q("projection_version")} AS ${q("publication_projection_version")},
          pub_head.${q("head_revision")} AS ${q("publication_head_revision")},
          retrieval_revision.${q("snapshot")} AS ${q("retrieval_snapshot")},
          retrieval_revision.${q("snapshot_digest")} AS ${q("retrieval_snapshot_digest")},
          retrieval_revision.${q("capability_snapshot")} AS ${q("retrieval_capability")},
          retrieval_revision.${q("capability_snapshot_digest")} AS ${q("retrieval_capability_digest")},
          retrieval_head.${q("active_revision")} AS ${q("retrieval_head_revision")},
          embedding_revision.${q("snapshot")} AS ${q("embedding_snapshot")},
          embedding_revision.${q("snapshot_digest")} AS ${q("embedding_snapshot_digest")},
          embedding_revision.${q("capability_snapshot")} AS ${q("embedding_capability")},
          embedding_revision.${q("capability_snapshot_digest")} AS ${q("embedding_capability_digest")},
          embedding_head.${q("active_revision")} AS ${q("embedding_head_revision")}
        FROM ${q("projection_set_publication_heads")} pub_head
        INNER JOIN ${q("projection_set_publications")} pub
          ON pub.${q("tenant_id")} = pub_head.${q("tenant_id")}
          AND pub.${q("knowledge_space_id")} = pub_head.${q("knowledge_space_id")}
          AND pub.${q("id")} = pub_head.${q("publication_id")}
          AND pub.${q("status")} = 'published'
        INNER JOIN ${q("knowledge_space_profile_publication_bindings")} binding
          ON binding.${q("tenant_id")} = pub_head.${q("tenant_id")}
          AND binding.${q("knowledge_space_id")} = pub_head.${q("knowledge_space_id")}
          AND binding.${q("publication_id")} = pub.${q("id")}
          AND binding.${q("publication_fingerprint")} = pub.${q("fingerprint")}
          AND binding.${q("activated_at")} IS NOT NULL
        INNER JOIN ${q("knowledge_space_profile_heads")} retrieval_head
          ON retrieval_head.${q("tenant_id")} = pub_head.${q("tenant_id")}
          AND retrieval_head.${q("knowledge_space_id")} = pub_head.${q("knowledge_space_id")}
          AND retrieval_head.${q("kind")} = 'retrieval'
          AND retrieval_head.${q("profile_revision_id")} = binding.${q(
            "retrieval_profile_revision_id",
          )}
          AND retrieval_head.${q("active_revision")} = binding.${q("retrieval_profile_revision")}
        INNER JOIN ${q("knowledge_space_profile_revisions")} retrieval_revision
          ON retrieval_revision.${q("id")} = retrieval_head.${q("profile_revision_id")}
          AND retrieval_revision.${q("tenant_id")} = retrieval_head.${q("tenant_id")}
          AND retrieval_revision.${q("knowledge_space_id")} = retrieval_head.${q("knowledge_space_id")}
          AND retrieval_revision.${q("kind")} = retrieval_head.${q("kind")}
          AND retrieval_revision.${q("revision")} = retrieval_head.${q("active_revision")}
          AND retrieval_revision.${q("snapshot_digest")} = binding.${q(
            "retrieval_profile_snapshot_digest",
          )}
          AND retrieval_revision.${q("state")} = 'active'
        LEFT JOIN ${q("knowledge_space_profile_heads")} embedding_head
          ON embedding_head.${q("tenant_id")} = pub_head.${q("tenant_id")}
          AND embedding_head.${q("knowledge_space_id")} = pub_head.${q("knowledge_space_id")}
          AND embedding_head.${q("kind")} = 'embedding'
        LEFT JOIN ${q("knowledge_space_profile_revisions")} embedding_revision
          ON embedding_revision.${q("id")} = embedding_head.${q("profile_revision_id")}
          AND embedding_revision.${q("tenant_id")} = embedding_head.${q("tenant_id")}
          AND embedding_revision.${q("knowledge_space_id")} = embedding_head.${q("knowledge_space_id")}
          AND embedding_revision.${q("kind")} = embedding_head.${q("kind")}
          AND embedding_revision.${q("revision")} = embedding_head.${q("active_revision")}
          AND embedding_revision.${q("state")} = 'active'
        WHERE pub_head.${q("tenant_id")} = ${p(1)}
          AND pub_head.${q("knowledge_space_id")} = ${p(2)}
          AND (
            (
              binding.${q("embedding_profile_revision_id")} IS NULL
              AND binding.${q("embedding_profile_revision")} IS NULL
              AND binding.${q("embedding_profile_snapshot_digest")} IS NULL
              AND binding.${q("vector_space_id")} IS NULL
              AND embedding_head.${q("profile_revision_id")} IS NULL
              AND embedding_revision.${q("id")} IS NULL
            )
            OR (
              binding.${q("embedding_profile_revision_id")} IS NOT NULL
              AND embedding_head.${q("profile_revision_id")} = binding.${q(
                "embedding_profile_revision_id",
              )}
              AND embedding_head.${q("active_revision")} = binding.${q(
                "embedding_profile_revision",
              )}
              AND embedding_revision.${q("id")} = binding.${q("embedding_profile_revision_id")}
              AND embedding_revision.${q("snapshot_digest")} = binding.${q(
                "embedding_profile_snapshot_digest",
              )}
              AND embedding_revision.${q("vector_space_id")} = binding.${q("vector_space_id")}
            )
          )
        LIMIT 1;`,
        tableName: "projection_set_publication_heads",
      });
      const row = result.rows[0];
      if (!row) throw new PublishedProjectionReadUnavailableError(input);

      const retrievalProfile = KnowledgeSpaceRetrievalProfileSchema.parse(
        jsonObjectColumn(row, "retrieval_snapshot"),
      );
      const retrievalCapability = jsonObjectColumn(row, "retrieval_capability");
      verifyDigest(row, "retrieval_snapshot_digest", retrievalProfile);
      verifyDigest(row, "retrieval_capability_digest", retrievalCapability);
      if (numberColumn(row, "retrieval_head_revision") !== retrievalProfile.revision) {
        throw new PublishedProjectionReadUnavailableError(input);
      }

      const embeddingJson = optionalJsonObjectColumn(row, "embedding_snapshot");
      const embeddingProfile = embeddingJson
        ? KnowledgeSpaceEmbeddingProfileSchema.parse(embeddingJson)
        : undefined;
      const embeddingCapability = optionalJsonObjectColumn(row, "embedding_capability");
      if (embeddingProfile) {
        verifyDigest(row, "embedding_snapshot_digest", embeddingProfile);
        if (
          numberColumn(row, "embedding_head_revision") !== embeddingProfile.revision ||
          !embeddingCapability
        ) {
          throw new PublishedProjectionReadUnavailableError(input);
        }
        verifyDigest(row, "embedding_capability_digest", embeddingCapability);
      } else if (embeddingCapability) {
        throw new PublishedProjectionReadUnavailableError(input);
      }

      try {
        assertRetrievalCapabilityMatchesProfile(retrievalCapability, retrievalProfile);
        if (embeddingProfile && embeddingCapability) {
          await assertEmbeddingCapabilityMatchesProfile(embeddingCapability, embeddingProfile);
        }
      } catch {
        throw new PublishedProjectionReadUnavailableError(input);
      }

      return Object.freeze({
        ...(embeddingCapability ? { embeddingCapabilitySnapshot: embeddingCapability } : {}),
        ...(embeddingProfile ? { embeddingProfile } : {}),
        projectionSnapshot: Object.freeze({
          fingerprint: stringColumn(row, "publication_fingerprint"),
          headRevision: numberColumn(row, "publication_head_revision"),
          knowledgeSpaceId: input.knowledgeSpaceId,
          projectionVersion: numberColumn(row, "publication_projection_version"),
          publicationId: stringColumn(row, "publication_id"),
          tenantId: input.tenantId,
        }),
        retrievalCapabilitySnapshot: retrievalCapability,
        retrievalProfile,
      });
    },
  };
}

async function assertEmbeddingCapabilityMatchesProfile(
  value: Readonly<Record<string, unknown>>,
  profile: KnowledgeSpaceEmbeddingProfile,
): Promise<void> {
  const capability = ModelCapabilitySnapshotSchema.parse(value);
  const dimension = capability.dimension;
  if (
    capability.kind !== "embedding" ||
    dimension === undefined ||
    dimension !== profile.dimension ||
    !capability.distanceMetric ||
    !sameSelection(capability, profile)
  ) {
    throw new Error("Embedding capability does not match its active profile");
  }
  const selection = {
    model: profile.model,
    pluginId: profile.pluginId,
    provider: profile.provider,
  };
  const [legacyVectorSpaceId, capabilityBoundVectorSpaceId] = await Promise.all([
    buildKnowledgeSpaceVectorSpaceId(selection, profile.revision),
    buildKnowledgeSpaceVectorSpaceId(selection, profile.revision, {
      capabilityDigest: capability.capabilityDigest,
      dimension,
      distanceMetric: capability.distanceMetric,
      pluginUniqueIdentifier: capability.pluginUniqueIdentifier,
      schemaFingerprint: capability.schemaFingerprint,
    }),
  ]);
  if (
    legacyVectorSpaceId !== profile.vectorSpaceId &&
    capabilityBoundVectorSpaceId !== profile.vectorSpaceId
  ) {
    throw new Error("Embedding vector space identity does not match its capability snapshot");
  }
}

function assertRetrievalCapabilityMatchesProfile(
  value: Readonly<Record<string, unknown>>,
  profile: KnowledgeSpaceRetrievalProfile,
): void {
  if (value.verification !== "verified") {
    throw new Error("Retrieval capability snapshot is not verified");
  }
  const reasoning = ModelCapabilitySnapshotSchema.parse(value.reasoning);
  if (reasoning.kind !== "reasoning" || !sameSelection(reasoning, profile.reasoningModel)) {
    throw new Error("Reasoning capability does not match its active profile");
  }
  if (profile.rerank.enabled) {
    const rerank = ModelCapabilitySnapshotSchema.parse(value.rerank);
    if (
      rerank.kind !== "rerank" ||
      !profile.rerank.model ||
      !sameSelection(rerank, profile.rerank.model)
    ) {
      throw new Error("Rerank capability does not match its active profile");
    }
  } else if (value.rerank != null) {
    throw new Error("Disabled rerank profile contains an active capability snapshot");
  }
}

function sameSelection(
  capability: ModelCapabilitySnapshot,
  selection: { readonly model: string; readonly pluginId: string; readonly provider: string },
): boolean {
  return (
    capability.selection.model === selection.model &&
    capability.selection.pluginId === selection.pluginId &&
    capability.selection.provider === selection.provider
  );
}

function verifyDigest(
  row: Parameters<typeof stringColumn>[0],
  column: string,
  value: unknown,
): void {
  if (stringColumn(row, column) !== knowledgeSpaceProfileSnapshotDigest(value)) {
    throw new Error(`Published runtime snapshot ${column} is corrupt`);
  }
}

function optionalJsonObjectColumn(
  row: Parameters<typeof jsonObjectColumn>[0],
  column: string,
): Record<string, unknown> | undefined {
  return row[column] == null ? undefined : jsonObjectColumn(row, column);
}
