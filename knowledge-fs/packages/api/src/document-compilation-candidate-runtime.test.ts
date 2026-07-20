import type { IndexProjection } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { DocumentCompilationAttempt } from "./document-compilation-attempt-repository";
import {
  createRepositoryDocumentCompilationCandidateEvaluator,
  createRepositoryDocumentCompilationFingerprintMaterialResolver,
} from "./document-compilation-candidate-runtime";

const tenantId = "tenant-1";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f1800001";
const ownerId = "018f0d60-7a49-7cc2-9c1b-5b36f1800002";
const inheritedId = "018f0d60-7a49-7cc2-9c1b-5b36f1800003";
const ownerGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f1800004";
const inheritedGeneration = "018f0d60-7a49-7cc2-9c1b-5b36f1800005";
const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f1800006";
const embeddingProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f1800010";
const retrievalProfileRevisionId = "018f0d60-7a49-7cc2-9c1b-5b36f1800011";
const embeddingProfileDigest = "1".repeat(64);
const retrievalProfileDigest = "2".repeat(64);
const vectorSpaceId = `embedding-space-sha256:${"a".repeat(64)}`;
const ownerOutlineId = "018f0d60-7a49-7cc2-9c1b-5b36f1800007";
const inheritedOutlineId = "018f0d60-7a49-7cc2-9c1b-5b36f1800008";
const ownerFtsId = "018f0d60-7a49-7cc2-9c1b-5b36f1800009";
const ownerDenseId = "018f0d60-7a49-7cc2-9c1b-5b36f180000a";
const inheritedFtsId = "018f0d60-7a49-7cc2-9c1b-5b36f180000b";
const inheritedDenseId = "018f0d60-7a49-7cc2-9c1b-5b36f180000c";
const createdAt = "2026-07-14T00:00:00.000Z";

describe("document compilation candidate runtime factories", () => {
  it("fingerprints the complete inherited + owner replacement snapshot and actual vector space", async () => {
    const outlines = new Map([
      [ownerOutlineId, outline(ownerOutlineId, ownerId, ownerGeneration, 2, "a")],
      [inheritedOutlineId, outline(inheritedOutlineId, inheritedId, inheritedGeneration, 1, "b")],
    ]);
    const projectionRows = [
      projection(ownerFtsId, ownerId, ownerGeneration, "fts", "database-fts@1", 2),
      projection(ownerDenseId, ownerId, ownerGeneration, "dense-vector", vectorSpaceId, 2),
      projection(inheritedFtsId, inheritedId, inheritedGeneration, "fts", "database-fts@1", 1),
      projection(
        inheritedDenseId,
        inheritedId,
        inheritedGeneration,
        "dense-vector",
        vectorSpaceId,
        1,
      ),
    ];
    const resolver = createRepositoryDocumentCompilationFingerprintMaterialResolver({
      artifacts: {
        getByDocumentVersion: vi.fn(async ({ documentAssetId, version }) => ({
          artifactHash: documentAssetId === ownerId ? "a".repeat(64) : "b".repeat(64),
          documentAssetId,
          version,
        })) as never,
      },
      assets: {
        get: vi.fn(async ({ id }) => ({
          id,
          sha256: id === ownerId ? "c".repeat(64) : "d".repeat(64),
          version: id === ownerId ? 2 : 1,
        })) as never,
      },
      maxComponents: 100,
      maxProjectionBatchSize: 10,
      members: {
        listByFingerprint: vi.fn(async () => [
          member(inheritedOutlineId, "document-outline", inheritedId, inheritedGeneration),
          member(inheritedFtsId, "index-projection", inheritedId, inheritedGeneration),
          member(inheritedDenseId, "index-projection", inheritedId, inheritedGeneration),
        ]),
      },
      outlines: { getById: vi.fn(async ({ id }) => outlines.get(id) ?? null) as never },
      projections: {
        getMany: vi.fn(async ({ ids }) => projectionRows.filter((item) => ids.includes(item.id))),
      },
      publications: {
        getPublished: vi.fn(async () => ({
          fingerprint: `projection-set-sha256:${"e".repeat(64)}`,
          headRevision: 3,
          id: publicationId,
        })) as never,
      },
      versions: {
        chunkerVersion: "chunker-v1",
        indexVersion: "index-v1",
        nodeSchemaVersion: 1,
        parserPolicyVersion: "parser-v1",
        projectionSetVersion: "projection-set-v1",
      },
    });

    const resolved = await resolver.resolve({
      attempt: attempt(),
      componentReceipt: {
        documentOutlines: [{ componentKey: ownerOutlineId, generationId: ownerGeneration }],
        graphEntities: [],
        graphRelations: [],
        indexProjections: [
          { componentKey: ownerFtsId, generationId: ownerGeneration },
          { componentKey: ownerDenseId, generationId: ownerGeneration },
        ],
        knowledgePaths: [],
        multimodalManifests: [],
        schemaVersion: 1,
      },
    });

    expect(resolved.projectionVersion).toBe(2);
    expect(resolved.material.sourceSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentAssetId: ownerId, version: 2 }),
        expect.objectContaining({ documentAssetId: inheritedId, version: 1 }),
      ]),
    );
    expect(resolved.material.projections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: vectorSpaceId, type: "dense-vector" }),
        expect.objectContaining({ model: "database-fts@1", type: "fts" }),
      ]),
    );
  });

  it("fails closed when the immutable base head changed before composition", async () => {
    const resolver = createRepositoryDocumentCompilationFingerprintMaterialResolver({
      artifacts: {} as never,
      assets: {} as never,
      maxComponents: 10,
      maxProjectionBatchSize: 10,
      members: {} as never,
      outlines: {} as never,
      projections: {} as never,
      publications: {
        getPublished: vi.fn(async () => ({ headRevision: 4 })) as never,
      },
      versions: {
        chunkerVersion: "chunker-v1",
        indexVersion: "index-v1",
        nodeSchemaVersion: 1,
        parserPolicyVersion: "parser-v1",
        projectionSetVersion: "projection-set-v1",
      },
    });

    await expect(
      resolver.resolve({
        attempt: attempt(),
        componentReceipt: emptyReceipt(),
      }),
    ).rejects.toThrow("publication head changed: expected=3 actual=4");
  });

  it("evaluates only the supplied candidate members and enforces PageIndex, FTS, and selected dense", async () => {
    const projectionRows = [
      projection(ownerFtsId, ownerId, ownerGeneration, "fts", "database-fts@1", 2),
      projection(ownerDenseId, ownerId, ownerGeneration, "dense-vector", vectorSpaceId, 2),
    ];
    const getMany = vi.fn(async () => projectionRows);
    const evaluator = createRepositoryDocumentCompilationCandidateEvaluator({
      maxProjectionBatchSize: 10,
      outlines: {
        getById: vi.fn(async () =>
          outline(ownerOutlineId, ownerId, ownerGeneration, 2, "a"),
        ) as never,
      },
      pageIndexBuild: { hasCompleteBuild: vi.fn(async () => true) },
      profiles: {
        getRevision: vi.fn(async ({ kind }) =>
          kind === "embedding"
            ? profileRevision("embedding", embeddingProfileRevisionId, embeddingProfileDigest, {
                dimension: 768,
                model: "embedding-model",
                pluginId: "embedding-plugin",
                provider: "embedding-provider",
                revision: 1,
                vectorSpaceId,
              })
            : profileRevision(
                "retrieval",
                retrievalProfileRevisionId,
                retrievalProfileDigest,
                retrievalProfile(),
              ),
        ) as never,
      },
      projections: { getMany },
    });
    const result = await evaluator.evaluate({
      candidateFingerprint: `projection-set-sha256:${"f".repeat(64)}`,
      candidatePublicationId: publicationId,
      documentAssetId: ownerId,
      documentVersion: 2,
      embeddingProfile: {
        kind: "embedding",
        revision: 1,
        revisionId: embeddingProfileRevisionId,
        snapshotDigest: embeddingProfileDigest,
      },
      expectedHeadRevision: 3,
      knowledgeSpaceId: spaceId,
      members: [
        member(ownerOutlineId, "document-outline", ownerId, ownerGeneration),
        member(ownerFtsId, "index-projection", ownerId, ownerGeneration),
        member(ownerDenseId, "index-projection", ownerId, ownerGeneration),
      ],
      publicationGenerationId: ownerGeneration,
      retrievalProfile: {
        kind: "retrieval",
        revision: 1,
        revisionId: retrievalProfileRevisionId,
        snapshotDigest: retrievalProfileDigest,
      },
      tenantId,
    });

    expect(result).toEqual({ decision: "passed" });
    expect(getMany).toHaveBeenCalledWith({
      ids: [ownerFtsId, ownerDenseId],
      knowledgeSpaceId: spaceId,
    });
  });

  it("does not require a flattened PageIndex build when the document setting disables it", async () => {
    const hasCompleteBuild = vi.fn(async () => false);
    const evaluator = createRepositoryDocumentCompilationCandidateEvaluator({
      indexOverrides: {
        resolve: vi.fn(async () => ({ enablePageIndex: false })),
      },
      maxProjectionBatchSize: 10,
      outlines: {
        getById: vi.fn(async () =>
          outline(ownerOutlineId, ownerId, ownerGeneration, 2, "a"),
        ) as never,
      },
      pageIndexBuild: { hasCompleteBuild },
      profiles: {
        getRevision: vi.fn(async ({ kind }) =>
          kind === "embedding"
            ? profileRevision("embedding", embeddingProfileRevisionId, embeddingProfileDigest, {
                dimension: 768,
                model: "embedding-model",
                pluginId: "embedding-plugin",
                provider: "embedding-provider",
                revision: 1,
                vectorSpaceId,
              })
            : profileRevision(
                "retrieval",
                retrievalProfileRevisionId,
                retrievalProfileDigest,
                retrievalProfile(),
              ),
        ) as never,
      },
      projections: {
        getMany: vi.fn(async () => [
          projection(ownerFtsId, ownerId, ownerGeneration, "fts", "database-fts@1", 2),
          projection(ownerDenseId, ownerId, ownerGeneration, "dense-vector", vectorSpaceId, 2),
        ]),
      },
    });

    await expect(
      evaluator.evaluate({
        candidateFingerprint: `projection-set-sha256:${"f".repeat(64)}`,
        candidatePublicationId: publicationId,
        compilationAttemptId: attempt().id,
        documentAssetId: ownerId,
        documentVersion: 2,
        embeddingProfile: {
          kind: "embedding",
          revision: 1,
          revisionId: embeddingProfileRevisionId,
          snapshotDigest: embeddingProfileDigest,
        },
        expectedHeadRevision: 3,
        knowledgeSpaceId: spaceId,
        members: [
          member(ownerOutlineId, "document-outline", ownerId, ownerGeneration),
          member(ownerFtsId, "index-projection", ownerId, ownerGeneration),
          member(ownerDenseId, "index-projection", ownerId, ownerGeneration),
        ],
        publicationGenerationId: ownerGeneration,
        retrievalProfile: {
          kind: "retrieval",
          revision: 1,
          revisionId: retrievalProfileRevisionId,
          snapshotDigest: retrievalProfileDigest,
        },
        tenantId,
      }),
    ).resolves.toEqual({ decision: "passed" });
    expect(hasCompleteBuild).not.toHaveBeenCalled();
  });
});

function attempt(): DocumentCompilationAttempt {
  return {
    activeSlot: 1,
    baseHeadRevision: 3,
    checkpoint: "nodes_generated",
    createdAt,
    documentAssetId: ownerId,
    documentVersion: 2,
    executionAttempts: 1,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f180000d",
    knowledgeSpaceId: spaceId,
    maxExecutionAttempts: 3,
    publicationGenerationId: ownerGeneration,
    rowVersion: 1,
    runState: "running",
    tenantId,
    updatedAt: createdAt,
  };
}

function retrievalProfile() {
  return {
    defaultMode: "research" as const,
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    },
    rerank: { enabled: false },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" as const },
    topK: 10,
  };
}

function profileRevision(
  kind: "embedding" | "retrieval",
  id: string,
  snapshotDigest: string,
  snapshot: Record<string, unknown>,
) {
  return {
    id,
    kind,
    knowledgeSpaceId: spaceId,
    revision: 1,
    snapshot,
    snapshotDigest,
    state: "active",
    tenantId,
  };
}

function member(
  componentKey: string,
  componentType: "document-outline" | "index-projection",
  documentAssetId: string,
  generationId: string,
) {
  return {
    componentKey,
    componentType,
    createdAt,
    documentAssetId,
    generationId,
    knowledgeSpaceId: spaceId,
    publicationId,
    tenantId,
  };
}

function outline(
  id: string,
  documentAssetId: string,
  generationId: string,
  version: number,
  hash: string,
) {
  return {
    artifactHash: hash.repeat(64),
    documentAssetId,
    id,
    knowledgeSpaceId: spaceId,
    publicationGenerationId: generationId,
    version,
  };
}

function projection(
  id: string,
  documentAssetId: string,
  generationId: string,
  type: IndexProjection["type"],
  model: string,
  projectionVersion: number,
): IndexProjection {
  return {
    id,
    knowledgeSpaceId: spaceId,
    metadata: { documentAssetId },
    model,
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f180000e",
    projectionVersion,
    publicationGenerationId: generationId,
    status: "building",
    type,
  };
}

function emptyReceipt() {
  return {
    documentOutlines: [],
    graphEntities: [],
    graphRelations: [],
    indexProjections: [],
    knowledgePaths: [],
    multimodalManifests: [],
    schemaVersion: 1 as const,
  };
}
