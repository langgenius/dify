import type {
  DocumentAsset,
  DocumentMultimodalManifest,
  ObjectMetadata,
  ObjectStorageAdapter,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import {
  createDeletionLifecycleFenceGuard,
  createInMemoryDeletionLifecycleFenceReader,
} from "./deletion-lifecycle-fence";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { GraphIndexRepository } from "./graph-index-repository";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  SourceDocumentStaleWriteScrubFenceRequiredError,
  SourceDocumentStaleWriteScrubScopeError,
  type SourceDocumentWorkflowOwnership,
  createSourceDocumentStaleWriteScrubber,
  createSourceWorkflowDocumentAssetId,
} from "./source-document-stale-write-scrubber";

const TENANT_ID = "Tenant Unsafe/@";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const SOURCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SPACE_PREFIX = `tenant-unsafe/spaces/${SPACE_ID}`;
const DOCUMENT_PREFIX = `${SPACE_PREFIX}/documents/${DOCUMENT_ID}/`;
const RAW_KEY = `${DOCUMENT_PREFIX}source.md`;
const SEGMENT_KEY = `${DOCUMENT_PREFIX}segments/segment-1.json`;
const MULTIMODAL_KEY = `${DOCUMENT_PREFIX}assets/image.png`;
const VARIANT_KEY = `${DOCUMENT_PREFIX}assets/image-thumb.png`;
const UNMANIFESTED_KEY = `${DOCUMENT_PREFIX}assets/late-put.png`;

describe("source document stale-write scrubber", () => {
  it("scrubs every exact document residue in dependency order and is idempotent", async () => {
    const harness = createHarness();

    await harness.scrubber.scrub(harness.input);

    expect(harness.mutations).toEqual([
      "graph",
      "outlines",
      "multimodal-manifests",
      "segments",
      "paths",
      "projections",
      "nodes",
      "artifacts",
      "asset",
      ...[MULTIMODAL_KEY, VARIANT_KEY, UNMANIFESTED_KEY, RAW_KEY, SEGMENT_KEY]
        .sort()
        .map((key) => `object:${key}`),
    ]);
    expect(harness.objects.size).toBe(0);

    harness.mutations.length = 0;
    await expect(harness.scrubber.scrub(harness.input)).resolves.toBeUndefined();
    expect(harness.mutations).toEqual([
      "outlines",
      "multimodal-manifests",
      "segments",
      "paths",
      "nodes",
      "artifacts",
      `object:${RAW_KEY}`,
    ]);
  });

  it("retries safely after object deletion fails after all database compensation", async () => {
    const harness = createHarness({ failObjectOnce: VARIANT_KEY });

    await expect(harness.scrubber.scrub(harness.input)).rejects.toThrow("injected object failure");
    expect(harness.mutations).toContain("asset");
    expect(harness.objects.has(VARIANT_KEY)).toBe(true);
    expect(harness.objects.has(RAW_KEY)).toBe(true);
    expect(harness.objects.has(SEGMENT_KEY)).toBe(true);

    harness.mutations.length = 0;
    await expect(harness.scrubber.scrub(harness.input)).resolves.toBeUndefined();
    expect(harness.objects.size).toBe(0);
    expect(harness.mutations).not.toContain("graph");
    expect(harness.mutations).not.toContain("projections");
  });

  it("requires a permanent fence and rejects an object outside the immutable manifest prefix", async () => {
    const noFence = createHarness({ activeFence: false });
    await expect(noFence.scrubber.scrub(noFence.input)).rejects.toBeInstanceOf(
      SourceDocumentStaleWriteScrubFenceRequiredError,
    );
    expect(noFence.mutations).toEqual([]);

    const escaped = createHarness();
    await expect(
      escaped.scrubber.scrub({ ...escaped.input, objectKey: `${TENANT_ID}/spaces/${SPACE_ID}/x` }),
    ).rejects.toBeInstanceOf(SourceDocumentStaleWriteScrubScopeError);
    expect(escaped.mutations).toEqual([]);
  });

  it("fails closed when the asset source scope or repository inventory is invalid", async () => {
    const wrongSource = createHarness({ assetSourceId: "another-source" });
    await expect(wrongSource.scrubber.scrub(wrongSource.input)).rejects.toThrow(
      "Document asset source does not match stale-write scope",
    );
    expect(wrongSource.mutations).toEqual([]);

    const unbounded = createHarness({ nodeIds: ["node-1", "node-2", "node-3"] });
    await expect(unbounded.scrubber.scrub(unbounded.input)).rejects.toThrow(
      "invalid stale-write inventory",
    );
    expect(unbounded.mutations).toEqual([]);
  });

  it("requires deterministic run ownership and retains every logically referenced asset", async () => {
    const ownership: SourceDocumentWorkflowOwnership = {
      contentHash: "a".repeat(64),
      itemKey: "provider-item-1",
      runId: "source-run-1",
    };
    const referenced = createHarness({
      activeFence: false,
      assetReferenced: true,
      workflowOwnership: ownership,
    });
    await expect(
      referenced.scrubber.scrubOwned({
        ...referenced.input,
        expectedVersion: 1,
        ownership,
        sourceId: SOURCE_ID,
      }),
    ).resolves.toBe(false);
    expect(referenced.mutations).toEqual([]);

    const unreferenced = createHarness({ activeFence: false, workflowOwnership: ownership });
    await expect(
      unreferenced.scrubber.scrubOwned({
        ...unreferenced.input,
        expectedVersion: 1,
        ownership,
        sourceId: SOURCE_ID,
      }),
    ).resolves.toBe(true);
    expect(unreferenced.objects.size).toBe(0);

    const mismatched = createHarness({ activeFence: false, workflowOwnership: ownership });
    await expect(
      mismatched.scrubber.scrubOwned({
        ...mismatched.input,
        expectedVersion: 1,
        ownership: { ...ownership, itemKey: "another-item" },
        sourceId: SOURCE_ID,
      }),
    ).rejects.toThrow("deterministic document asset");
    expect(mismatched.mutations).toEqual([]);

    const durablyScheduled = createHarness({ workflowOwnership: ownership });
    await expect(
      durablyScheduled.scrubber.scrubOwned({
        ...durablyScheduled.input,
        expectedVersion: 1,
        ownership,
        sourceId: SOURCE_ID,
      }),
    ).resolves.toBe(false);
    expect(durablyScheduled.mutations).toEqual([]);
  });
});

function createHarness({
  activeFence = true,
  assetReferenced = false,
  assetSourceId = SOURCE_ID,
  failObjectOnce,
  nodeIds: initialNodeIds = ["node-1", "node-2"],
  workflowOwnership,
}: {
  readonly activeFence?: boolean;
  readonly assetReferenced?: boolean;
  readonly assetSourceId?: string;
  readonly failObjectOnce?: string | undefined;
  readonly nodeIds?: readonly string[];
  readonly workflowOwnership?: SourceDocumentWorkflowOwnership | undefined;
} = {}) {
  const documentId = workflowOwnership
    ? createSourceWorkflowDocumentAssetId(workflowOwnership)
    : DOCUMENT_ID;
  const documentPrefix = `${SPACE_PREFIX}/documents/${documentId}/`;
  const rawKey = `${documentPrefix}source.md`;
  const segmentKey = `${documentPrefix}segments/segment-1.json`;
  const multimodalKey = `${documentPrefix}assets/image.png`;
  const variantKey = `${documentPrefix}assets/image-thumb.png`;
  const unmanifestedKey = `${documentPrefix}assets/late-put.png`;
  const mutations: string[] = [];
  const objects = new Set([rawKey, segmentKey, multimodalKey, variantKey, unmanifestedKey]);
  let shouldFailObject = Boolean(failObjectOnce);
  let assetExists = true;
  let nodeIds = [...initialNodeIds];
  let segmentsExist = true;
  let multimodalExists = true;

  const reader = createInMemoryDeletionLifecycleFenceReader(
    activeFence
      ? [
          {
            id: "fence-1",
            knowledgeSpaceId: SPACE_ID,
            targetId: SOURCE_ID,
            targetType: "source",
            tenantId: TENANT_ID,
          },
        ]
      : [],
  );
  const objectStorage = {
    deleteObject: async (key: string) => {
      mutations.push(`object:${key}`);
      if (key === failObjectOnce && shouldFailObject) {
        shouldFailObject = false;
        throw new Error("injected object failure");
      }
      objects.delete(key);
    },
    listObjects: async ({
      cursor,
      limit,
      prefix,
    }: Parameters<ObjectStorageAdapter["listObjects"]>[0]) => {
      const page = [...objects]
        .filter((key) => key.startsWith(prefix))
        .filter((key) => (cursor ? key > cursor : true))
        .sort()
        .slice(0, limit + 1);
      const keys = page.slice(0, limit);
      const metadata: ObjectMetadata[] = keys.map((key) => ({ key, metadata: {}, sizeBytes: 1 }));
      const nextCursor = page.length > limit ? keys.at(-1) : undefined;

      return { objects: metadata, ...(nextCursor ? { nextCursor } : {}) };
    },
  };
  const asset = {
    id: documentId,
    knowledgeSpaceId: SPACE_ID,
    metadata: {
      tenantId: TENANT_ID,
      ...(workflowOwnership
        ? { [SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY]: { ...workflowOwnership } }
        : {}),
    },
    objectKey: rawKey,
    sourceId: assetSourceId,
    version: 1,
  } as unknown as DocumentAsset;
  const documentManifest = {
    items: [
      {
        assetRef: {
          objectKey: multimodalKey,
          variants: { thumb: { objectKey: variantKey } },
        },
      },
    ],
  } as unknown as DocumentMultimodalManifest;

  const scrubber = createSourceDocumentStaleWriteScrubber({
    artifactSegments: {
      deleteByDocumentAsset: async () => {
        mutations.push("segments");
        const deleted = segmentsExist ? 1 : 0;
        segmentsExist = false;
        return deleted;
      },
      listByDocumentAsset: async () =>
        segmentsExist ? ([{ id: "segment-1", objectKey: segmentKey }] as never[]) : [],
    } as unknown as ArtifactSegmentRepository,
    artifacts: {
      deleteByDocumentAsset: async () => {
        mutations.push("artifacts");
        return 1;
      },
    } as unknown as ParseArtifactRepository,
    assets: {
      rollbackStaleWrite: async ({
        expectedObjectKey,
        expectedVersion,
      }: Parameters<DocumentAssetRepository["rollbackStaleWrite"]>[0]) => {
        mutations.push("asset");
        const deleted =
          assetExists && asset.objectKey === expectedObjectKey && asset.version === expectedVersion
            ? asset
            : null;
        assetExists = false;
        return deleted;
      },
      get: async () => (assetExists ? asset : null),
      getForDeletion: async () => (assetExists ? asset : null),
    } as unknown as DocumentAssetRepository,
    bounds: {
      maxArtifacts: 2,
      maxGraphGenerations: 2,
      maxManifests: 2,
      maxNodes: 2,
      maxObjects: 10,
      maxOutlines: 2,
      maxPaths: 10,
      maxProjections: 10,
      maxSegments: 2,
      objectListPageSize: 2,
    },
    deletionFence: createDeletionLifecycleFenceGuard(reader),
    graph: {
      pruneSourceNodesAcrossGenerations: async () => {
        mutations.push("graph");
        return {
          prunedEntities: 0,
          prunedRelations: 0,
          updatedEntities: 0,
          updatedRelations: 0,
        };
      },
    } as unknown as GraphIndexRepository,
    manifests: {
      get: async () => ({ objectKeyPrefix: SPACE_PREFIX }),
    } as unknown as KnowledgeSpaceManifestRepository,
    logicalDocuments: {
      isAssetReferenced: async () => assetReferenced,
    },
    multimodalManifests: {
      deleteByDocumentAsset: async () => {
        mutations.push("multimodal-manifests");
        const deleted = multimodalExists ? 1 : 0;
        multimodalExists = false;
        return deleted;
      },
      listByDocumentAsset: async () => (multimodalExists ? [documentManifest] : []),
    } as unknown as DocumentMultimodalManifestRepository,
    nodes: {
      deleteByDocumentAsset: async () => {
        mutations.push("nodes");
        const deleted = nodeIds;
        nodeIds = [];
        return { deleted: deleted.length, nodeIds: deleted };
      },
      listIdsByDocumentAsset: async () => nodeIds,
    } as unknown as KnowledgeNodeRepository,
    objectStorage,
    outlines: {
      deleteByDocumentAsset: async () => {
        mutations.push("outlines");
        return 1;
      },
    } as unknown as DocumentOutlineRepository,
    paths: {
      deleteByDocumentAsset: async () => {
        mutations.push("paths");
        return 1;
      },
    } as unknown as KnowledgePathRepository,
    projections: {
      deleteByNodeIds: async () => {
        mutations.push("projections");
        return 2;
      },
    } as unknown as IndexProjectionRepository,
  });

  return {
    input: {
      documentAssetId: documentId,
      knowledgeSpaceId: SPACE_ID,
      objectKey: rawKey,
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    },
    mutations,
    objects,
    scrubber,
  };
}
