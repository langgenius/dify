import { KnowledgeSpaceObjectKeyPrefixSchema, type ObjectStorageAdapter } from "@knowledge/core";

import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
} from "./deletion-lifecycle-fence";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { GraphIndexRepository } from "./graph-index-repository";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { LogicalDocumentRepository } from "./logical-document-repository";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  type SourceDocumentWorkflowOwnership,
  createSourceWorkflowDocumentAssetId,
  sourceWorkflowOwnershipMatches,
} from "./source-document-workflow-ownership";

export {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  type SourceDocumentWorkflowOwnership,
  createSourceWorkflowDocumentAssetId,
} from "./source-document-workflow-ownership";

export interface SourceDocumentStaleWriteScrubInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly objectKey: string;
  readonly sourceId?: string | undefined;
  readonly tenantId: string;
}

export interface SourceDocumentStaleWriteScrubber {
  scrub(input: SourceDocumentStaleWriteScrubInput): Promise<void>;
  /** Exact run-owned compensation. Returns false when any logical revision references the asset. */
  scrubOwned(
    input: SourceDocumentStaleWriteScrubInput & {
      readonly expectedVersion: number;
      readonly ownership: SourceDocumentWorkflowOwnership;
      readonly sourceId: string;
    },
  ): Promise<boolean>;
}

export interface SourceDocumentStaleWriteScrubberBounds {
  readonly maxArtifacts: number;
  readonly maxGraphGenerations: number;
  readonly maxManifests: number;
  readonly maxNodes: number;
  readonly maxObjects: number;
  readonly maxOutlines: number;
  readonly maxPaths: number;
  readonly maxProjections: number;
  readonly maxSegments: number;
  readonly objectListPageSize?: number | undefined;
}

export interface CreateSourceDocumentStaleWriteScrubberOptions {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly artifacts: ParseArtifactRepository;
  readonly assets: DocumentAssetRepository;
  readonly bounds: SourceDocumentStaleWriteScrubberBounds;
  readonly deletionFence: DeletionLifecycleFenceGuard;
  readonly graph: GraphIndexRepository;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly logicalDocuments?: Pick<LogicalDocumentRepository, "isAssetReferenced"> | undefined;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: Pick<ObjectStorageAdapter, "deleteObject" | "listObjects">;
  readonly outlines: DocumentOutlineRepository;
  readonly paths: KnowledgePathRepository;
  readonly projections: IndexProjectionRepository;
}

export class SourceDocumentStaleWriteScrubFenceRequiredError extends Error {
  constructor() {
    super("Source document stale-write scrub requires an active deletion lifecycle fence");
    this.name = "SourceDocumentStaleWriteScrubFenceRequiredError";
  }
}

export class SourceDocumentStaleWriteScrubScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceDocumentStaleWriteScrubScopeError";
  }
}

/**
 * Exact, bounded compensation for a single document writer that lost its deletion fence.
 *
 * Inventory is completed before the first mutation. The graph is pruned while source node ids are
 * still available; outline deletion cascades flattened PageIndex rows; object deletion is last and
 * repeats safely after a partial failure. The deletion path requires an active (including
 * completed) tombstone. The workflow path instead requires a deterministic asset id, exact
 * run/item/hash metadata, and a logical-revision reference check, so neither capability can be
 * used as an unfenced general-purpose delete endpoint.
 */
export function createSourceDocumentStaleWriteScrubber({
  artifactSegments,
  artifacts,
  assets,
  bounds: rawBounds,
  deletionFence,
  graph,
  manifests,
  logicalDocuments,
  multimodalManifests,
  nodes,
  objectStorage,
  outlines,
  paths,
  projections,
}: CreateSourceDocumentStaleWriteScrubberOptions): SourceDocumentStaleWriteScrubber {
  const bounds = validateBounds(rawBounds);

  const scrubDocument = async (
    rawInput: SourceDocumentStaleWriteScrubInput,
    owned:
      | {
          readonly expectedVersion: number;
          readonly ownership: SourceDocumentWorkflowOwnership;
        }
      | undefined,
  ): Promise<boolean> => {
    const input = validateInput(rawInput);
    if (owned) {
      validateOwnership(owned.ownership);
      if (
        input.documentAssetId !== createSourceWorkflowDocumentAssetId(owned.ownership) ||
        !input.sourceId
      ) {
        throw new SourceDocumentStaleWriteScrubScopeError(
          "Source workflow ownership does not match the deterministic document asset",
        );
      }
      if (!logicalDocuments) {
        throw new SourceDocumentStaleWriteScrubScopeError(
          "Logical document ownership fence is unavailable for Source compensation",
        );
      }
      if (await hasActiveDeletionFence(deletionFence, input)) return false;
      if (
        await logicalDocuments.isAssetReferenced({
          documentAssetId: input.documentAssetId,
          documentAssetVersion: owned.expectedVersion,
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        })
      ) {
        return false;
      }
    } else {
      await assertFenceActive(deletionFence, input);
    }

    const manifest = await manifests.get({
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: input.tenantId,
    });
    if (!manifest) {
      throw new SourceDocumentStaleWriteScrubScopeError(
        "Knowledge-space manifest is unavailable for stale-write compensation",
      );
    }
    const spaceObjectPrefix = KnowledgeSpaceObjectKeyPrefixSchema.parse(manifest.objectKeyPrefix);
    const documentObjectPrefix = `${spaceObjectPrefix}/documents/${input.documentAssetId}/`;
    assertDocumentObjectKey(input.objectKey, documentObjectPrefix, "raw document");

    const asset = await (owned ? assets.getForDeletion : assets.get)({
      id: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });
    if (asset) {
      if (asset.objectKey !== input.objectKey) {
        throw new SourceDocumentStaleWriteScrubScopeError(
          "Document asset object key does not match stale-write scope",
        );
      }
      if ((asset.sourceId ?? undefined) !== input.sourceId) {
        throw new SourceDocumentStaleWriteScrubScopeError(
          "Document asset source does not match stale-write scope",
        );
      }
      if (
        typeof asset.metadata.tenantId === "string" &&
        asset.metadata.tenantId !== input.tenantId
      ) {
        throw new SourceDocumentStaleWriteScrubScopeError(
          "Document asset tenant metadata does not match stale-write scope",
        );
      }
      if (owned) {
        if (asset.version !== owned.expectedVersion) {
          throw new SourceDocumentStaleWriteScrubScopeError(
            "Document asset version does not match Source workflow ownership",
          );
        }
        assertWorkflowOwnership(asset.metadata, owned.ownership);
      }
    }

    // Complete every inventory read before mutating a repository. Prefix inventory also captures
    // multimodal puts that lost the fence before their manifest row was committed.
    const [nodeIds, segments, documentManifests, storedObjectKeys] = await Promise.all([
      nodes.listIdsByDocumentAsset({
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxNodes: bounds.maxNodes,
      }),
      artifactSegments.listByDocumentAsset({
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxSegments: bounds.maxSegments,
      }),
      multimodalManifests.listByDocumentAsset({
        documentAssetId: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxManifests: bounds.maxManifests,
      }),
      inventoryDocumentObjects({
        maxObjects: bounds.maxObjects,
        objectListPageSize: bounds.objectListPageSize,
        objectStorage,
        prefix: documentObjectPrefix,
      }),
    ]);
    if (nodeIds.length > bounds.maxNodes || new Set(nodeIds).size !== nodeIds.length) {
      throw new Error("Knowledge node repository returned an invalid stale-write inventory");
    }
    if (segments.length > bounds.maxSegments) {
      throw new Error("Artifact segment repository returned an unbounded stale-write inventory");
    }
    if (documentManifests.length > bounds.maxManifests) {
      throw new Error("Multimodal manifest repository returned an unbounded stale-write inventory");
    }

    const exactObjectKeys = new Set<string>([input.objectKey, ...storedObjectKeys]);
    for (const segment of segments) {
      if (segment.objectKey) {
        assertDocumentObjectKey(segment.objectKey, documentObjectPrefix, "artifact segment");
        exactObjectKeys.add(segment.objectKey);
      }
    }
    for (const documentManifest of documentManifests) {
      for (const key of manifestObjectKeys(documentManifest.items, bounds.maxObjects)) {
        assertDocumentObjectKey(key, documentObjectPrefix, "multimodal manifest");
        exactObjectKeys.add(key);
      }
    }
    if (exactObjectKeys.size > bounds.maxObjects) {
      throw new Error(`Stale-write object inventory exceeds maxObjects=${bounds.maxObjects}`);
    }

    if (nodeIds.length > 0) {
      await graph.pruneSourceNodesAcrossGenerations({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxGenerations: bounds.maxGraphGenerations,
        maxSourceNodes: bounds.maxNodes,
        sourceNodeIds: nodeIds,
      });
    }
    // document_outlines owns flattened PageIndex manifests/nodes/terms through ON DELETE CASCADE.
    await outlines.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxOutlines: bounds.maxOutlines,
    });
    await multimodalManifests.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxManifests: bounds.maxManifests,
    });
    await artifactSegments.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxSegments: bounds.maxSegments,
    });
    await paths.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxPaths: bounds.maxPaths,
    });
    if (nodeIds.length > 0) {
      await projections.deleteByNodeIds({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxProjections: bounds.maxProjections,
        nodeIds,
      });
    }
    await nodes.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxNodes: bounds.maxNodes,
    });
    await artifacts.deleteByDocumentAsset({
      documentAssetId: input.documentAssetId,
      maxArtifacts: bounds.maxArtifacts,
    });
    if (asset) {
      const rolledBack = await assets.rollbackStaleWrite({
        expectedObjectKey: asset.objectKey,
        expectedVersion: asset.version,
        id: input.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (owned && !rolledBack) return false;
    }

    for (const key of [...exactObjectKeys].sort()) {
      await objectStorage.deleteObject(key);
    }
    return true;
  };

  return {
    scrub: async (input) => {
      await scrubDocument(input, undefined);
    },
    scrubOwned: (input) =>
      scrubDocument(input, {
        expectedVersion: input.expectedVersion,
        ownership: input.ownership,
      }),
  };
}

async function hasActiveDeletionFence(
  fence: DeletionLifecycleFenceGuard,
  input: SourceDocumentStaleWriteScrubInput,
): Promise<boolean> {
  try {
    await fence.captureDeletionFence({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      tenantId: input.tenantId,
    });
    return false;
  } catch (error) {
    if (error instanceof DeletionLifecycleFenceActiveError) {
      assertFenceMatchesInput(error, input);
      return true;
    }
    throw error;
  }
}

async function assertFenceActive(
  fence: DeletionLifecycleFenceGuard,
  input: SourceDocumentStaleWriteScrubInput,
): Promise<void> {
  try {
    await fence.captureDeletionFence({
      documentAssetId: input.documentAssetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      tenantId: input.tenantId,
    });
  } catch (error) {
    if (error instanceof DeletionLifecycleFenceActiveError) {
      assertFenceMatchesInput(error, input);
      return;
    }
    throw error;
  }
  throw new SourceDocumentStaleWriteScrubFenceRequiredError();
}

function assertFenceMatchesInput(
  error: DeletionLifecycleFenceActiveError,
  input: SourceDocumentStaleWriteScrubInput,
): void {
  const { fence } = error;
  const targetMatches =
    (fence.targetType === "space" && fence.targetId === input.knowledgeSpaceId) ||
    (fence.targetType === "source" && fence.targetId === input.sourceId) ||
    (fence.targetType === "document" && fence.targetId === input.documentAssetId);
  if (
    fence.tenantId !== input.tenantId ||
    fence.knowledgeSpaceId !== input.knowledgeSpaceId ||
    !targetMatches
  ) {
    throw new SourceDocumentStaleWriteScrubScopeError(
      "Deletion lifecycle fence does not match stale-write scope",
    );
  }
}

async function inventoryDocumentObjects({
  maxObjects,
  objectListPageSize,
  objectStorage,
  prefix,
}: {
  readonly maxObjects: number;
  readonly objectListPageSize: number;
  readonly objectStorage: Pick<ObjectStorageAdapter, "listObjects">;
  readonly prefix: string;
}): Promise<readonly string[]> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const remaining = maxObjects - keys.size;
    if (remaining < 1) {
      throw new Error(`Stale-write object inventory exceeds maxObjects=${maxObjects}`);
    }
    const page = await objectStorage.listObjects({
      ...(cursor ? { cursor } : {}),
      limit: Math.min(objectListPageSize, remaining),
      prefix,
    });
    if (page.objects.length > Math.min(objectListPageSize, remaining)) {
      throw new Error("Object storage returned an unbounded stale-write inventory page");
    }
    for (const object of page.objects) {
      assertDocumentObjectKey(object.key, prefix, "object inventory");
      if (keys.has(object.key)) {
        throw new Error("Object storage returned a duplicate stale-write inventory key");
      }
      keys.add(object.key);
    }
    if (!page.nextCursor) {
      return [...keys];
    }
    if (page.nextCursor === cursor || page.objects.length === 0) {
      throw new Error("Object storage returned a non-progressing stale-write inventory cursor");
    }
    cursor = page.nextCursor;
  }
}

function manifestObjectKeys(items: unknown, maxObjects: number): readonly string[] {
  const keys = new Set<string>();
  const stack: unknown[] = [items];
  let visited = 0;
  while (stack.length > 0) {
    visited += 1;
    if (visited > maxObjects * 32) {
      throw new Error("Multimodal manifest object inventory exceeds traversal bound");
    }
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        if (key === "objectKey" && typeof child === "string" && child) {
          keys.add(child);
          if (keys.size > maxObjects) {
            throw new Error(
              `Multimodal manifest object inventory exceeds maxObjects=${maxObjects}`,
            );
          }
        } else {
          stack.push(child);
        }
      }
    }
  }
  return [...keys];
}

function assertDocumentObjectKey(key: string, prefix: string, kind: string): void {
  if (
    !key ||
    key !== key.trim() ||
    key.length > 2_048 ||
    !key.startsWith(prefix) ||
    key
      .slice(prefix.length)
      .split("/")
      .some((segment) => segment === ".." || segment === ".")
  ) {
    throw new SourceDocumentStaleWriteScrubScopeError(
      `${kind} object key escapes the exact document namespace`,
    );
  }
}

function validateInput(
  input: SourceDocumentStaleWriteScrubInput,
): SourceDocumentStaleWriteScrubInput {
  for (const [field, value] of [
    ["documentAssetId", input.documentAssetId],
    ["knowledgeSpaceId", input.knowledgeSpaceId],
    ["tenantId", input.tenantId],
    ["objectKey", input.objectKey],
  ] as const) {
    if (!value || value !== value.trim() || value.length > 2_048) {
      throw new SourceDocumentStaleWriteScrubScopeError(`Stale-write ${field} is invalid`);
    }
  }
  if (
    input.sourceId !== undefined &&
    (!input.sourceId || input.sourceId !== input.sourceId.trim())
  ) {
    throw new SourceDocumentStaleWriteScrubScopeError("Stale-write sourceId is invalid");
  }

  return { ...input };
}

function validateOwnership(ownership: SourceDocumentWorkflowOwnership): void {
  for (const [field, value, maxLength] of [
    ["runId", ownership.runId, 255],
    ["itemKey", ownership.itemKey, 2_048],
  ] as const) {
    if (!value || value !== value.trim() || value.length > maxLength) {
      throw new SourceDocumentStaleWriteScrubScopeError(
        `Source workflow ownership ${field} is invalid`,
      );
    }
  }
  if (!/^[0-9a-f]{64}$/.test(ownership.contentHash)) {
    throw new SourceDocumentStaleWriteScrubScopeError(
      "Source workflow ownership contentHash is invalid",
    );
  }
}

function assertWorkflowOwnership(
  metadata: Readonly<Record<string, unknown>>,
  expected: SourceDocumentWorkflowOwnership,
): void {
  const value = metadata[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY];
  if (!sourceWorkflowOwnershipMatches(value, expected)) {
    throw new SourceDocumentStaleWriteScrubScopeError(
      "Document asset Source workflow ownership proof does not match",
    );
  }
}

function validateBounds(bounds: SourceDocumentStaleWriteScrubberBounds): Omit<
  SourceDocumentStaleWriteScrubberBounds,
  "objectListPageSize"
> & {
  readonly objectListPageSize: number;
} {
  const normalized = {
    ...bounds,
    objectListPageSize: bounds.objectListPageSize ?? Math.min(bounds.maxObjects, 1_000),
  };
  for (const [field, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
      throw new Error(`Source document stale-write scrubber ${field} must be between 1 and 100000`);
    }
  }
  if (normalized.objectListPageSize > normalized.maxObjects) {
    throw new Error("Stale-write objectListPageSize must not exceed maxObjects");
  }

  return normalized;
}
