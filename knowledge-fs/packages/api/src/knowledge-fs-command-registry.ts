import { createHash, randomUUID } from "node:crypto";

import { cloneTextDiffOperation, uniqueStrings } from "./api-shared-utils";
import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import { hasScope } from "./auth";
import {
  CandidateVisibilityScanBudgetExceededError,
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
  candidatePermissionScopeAllows,
} from "./candidate-content-authorization";
import {
  decodeGraphEntityCursor,
  decodeKnowledgePathCursor,
  encodeGraphEntityCursor,
  encodeKnowledgePathCursor,
} from "./cursor-utils";
import {
  DeletionLifecycleFenceActiveError,
  type DeletionLifecycleFenceGuard,
} from "./deletion-lifecycle-fence";
import {
  type DeletionObjectWriteAdmission,
  DeletionObjectWriteAdmissionError,
} from "./deletion-object-write-admission";
import { withDeletionObjectWriteAdmission } from "./deletion-object-write-storage";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import type { DocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import { KnowledgeFsUnavailableError } from "./gateway-defaults";
import type {
  GraphEntity,
  GraphEntityCursor,
  GraphIndexRepository,
} from "./graph-index-repository";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { KnowledgeFsNotFoundError, KnowledgeFsValidationError } from "./knowledge-fs-errors";
import {
  KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
  KNOWLEDGE_FS_BY_ENTITY_ROOT,
  KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
  LIVE_SEMANTIC_VIEW_METADATA,
  assertKnowledgeFsByCommunityListPath,
  assertKnowledgeFsByTopicListPath,
  isKnowledgeFsByCommunityPath,
  isKnowledgeFsByEntityPath,
  isKnowledgeFsByTopicPath,
  knowledgeFsByEntityIdFromPath,
  knowledgePathDescendantPrefix,
  normalizeKnowledgeFsPath,
  parseKnowledgeFsPhysicalPath,
} from "./knowledge-fs-path-utils";
import {
  type KnowledgeFsCommandInput,
  KnowledgeFsCommandInputSchema,
  type KnowledgeFsDiffCommandInput,
  KnowledgeFsDiffCommandInputSchema,
  type KnowledgeFsFindCommandInput,
  KnowledgeFsFindCommandInputSchema,
  type KnowledgeFsGrepCommandInput,
  KnowledgeFsGrepCommandInputSchema,
  type KnowledgeFsOpenNodeCommandInput,
  KnowledgeFsOpenNodeCommandInputSchema,
  type KnowledgeFsReadCommandInput,
  KnowledgeFsReadCommandInputSchema,
  type KnowledgeFsWriteCommandInput,
  KnowledgeFsWriteCommandInputSchema,
} from "./knowledge-fs-request-schemas";
import { SemanticDiffSummarySchema } from "./knowledge-fs-response-schemas";
import type {
  KnowledgeFsCatResult,
  KnowledgeFsDiffResult,
  KnowledgeFsEntry,
  KnowledgeFsGrepMatch,
  KnowledgeFsGrepResult,
  KnowledgeFsListResult,
  KnowledgeFsOpenNodeResult,
  KnowledgeFsStatResult,
  KnowledgeFsTreeNode,
  KnowledgeFsTreeResult,
  KnowledgeFsWriteResult,
  SemanticDiffProvider,
  SemanticDiffSummary,
} from "./knowledge-fs-types";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";
import {
  type KnowledgePathCursor,
  type KnowledgePathRepository,
  knowledgePathCursor,
} from "./knowledge-path-repository";
import {
  type LegacySpacePublicationBootstrapRepository,
  withKnowledgeSpaceDocumentMutationLease,
} from "./legacy-space-publication-bootstrap";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import { createDocumentObjectKey } from "./storage-path-utils";

import type { ComputeRuntime, TextDiff, TextDiffOperation } from "@knowledge/compute";
import {
  type AuthSubject,
  type CommandName,
  type DocumentOutlineNode,
  type KnowledgeNode,
  type KnowledgePath,
  KnowledgePathSchema,
  type KnowledgeSpaceConsistencyClass,
  type ParseArtifact,
  type ParseElement,
  type PlatformAdapter,
  createCommandRegistry,
} from "@knowledge/core";

const EVENTUAL_PREVIEW_UNSUPPORTED_COMMANDS = new Set<CommandName>([
  "cat",
  "diff",
  "grep",
  "open_node",
  "write",
  "append",
]);
const KNOWLEDGE_FS_MAX_SCAN_PAGES = 10;
const KNOWLEDGE_FS_MAX_PERMISSION_CLOSURE_ITEMS = 256;

export interface CreateKnowledgeFsCommandRegistryOptions {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly compute: ComputeRuntime;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly graph: GraphIndexRepository;
  readonly documentMutationAdmissionGuard?:
    | Pick<
        LegacySpacePublicationBootstrapRepository,
        "acquireDocumentMutationLease" | "releaseDocumentMutationLease"
      >
    | undefined;
  readonly documentMutationLeaseNow?: (() => string) | undefined;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly maxTreeDepth: number;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly semanticDiffProvider?: SemanticDiffProvider | undefined;
}

export function createKnowledgeFsCommandRegistry({
  assets,
  artifactSegments,
  compute,
  deletionFence,
  documentMutationAdmissionGuard,
  documentMutationLeaseNow = () => new Date().toISOString(),
  graph,
  multimodalManifestEnhancer,
  nodes,
  objectWriteAdmission,
  objectStorage,
  outlines,
  maxTreeDepth,
  parseArtifacts,
  paths,
  semanticDiffProvider,
}: CreateKnowledgeFsCommandRegistryOptions) {
  const registry = createCommandRegistry({ maxCommands: 10 });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ input }) =>
      withKnowledgeFsPreviewResult(
        input,
        await listKnowledgeFsDirectory({
          artifactSegments,
          assets,
          graph,
          input,
          nodes,
          parseArtifacts,
          paths,
        }),
      ),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedRows: input.limit + 1 }),
    inputSchema: KnowledgeFsCommandInputSchema.omit({ depth: true }),
    name: "ls",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ input }) =>
      withKnowledgeFsPreviewResult(
        input,
        await treeKnowledgeFsDirectory({
          artifactSegments,
          assets,
          input: {
            ...input,
            depth: input.depth ?? maxTreeDepth,
          },
          nodes,
          parseArtifacts,
          paths,
        }),
      ),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedRows: input.limit + 1 }),
    inputSchema: KnowledgeFsCommandInputSchema,
    name: "tree",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) => {
      assertKnowledgeFsCommandConsistency(
        "grep",
        context.consistencyClass ?? input.consistencyClass,
      );

      return grepKnowledgeFsPath({
        artifactSegments,
        assets,
        input,
        multimodalManifestEnhancer,
        nodes,
        objectStorage,
        outlines,
        parseArtifacts,
        paths,
        ...(context.subject.tenantId ? { tenantId: context.subject.tenantId } : {}),
      });
    },
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedRows: input.limit + 1 }),
    inputSchema: KnowledgeFsGrepCommandInputSchema,
    name: "grep",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ input }) =>
      withKnowledgeFsPreviewResult(
        input,
        await findKnowledgeFsPaths({
          artifactSegments,
          assets,
          input,
          nodes,
          parseArtifacts,
          paths,
        }),
      ),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedRows: input.limit + 1 }),
    inputSchema: KnowledgeFsFindCommandInputSchema,
    name: "find",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) => {
      assertKnowledgeFsCommandConsistency(
        "diff",
        context.consistencyClass ?? input.consistencyClass,
      );

      return diffKnowledgeFsPaths({
        assets,
        artifactSegments,
        compute,
        input,
        multimodalManifestEnhancer,
        nodes,
        objectStorage,
        outlines,
        parseArtifacts,
        paths,
        semanticDiffProvider,
        ...(context.subject.tenantId ? { tenantId: context.subject.tenantId } : {}),
      });
    },
    degradation: { strategy: "fail-closed" },
    estimateCost: () => ({ estimatedRows: 4 }),
    inputSchema: KnowledgeFsDiffCommandInputSchema,
    name: "diff",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) => {
      assertKnowledgeFsCommandConsistency(
        "open_node",
        context.consistencyClass ?? input.consistencyClass,
      );

      return openKnowledgeFsNode({ assets, input, nodes });
    },
    degradation: { strategy: "fail-closed" },
    estimateCost: () => ({ estimatedRows: 1 }),
    inputSchema: KnowledgeFsOpenNodeCommandInputSchema,
    name: "open_node",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) => {
      assertKnowledgeFsCommandConsistency(
        "cat",
        context.consistencyClass ?? input.consistencyClass,
      );

      return catKnowledgeFsPath({
        assets,
        artifactSegments,
        input,
        multimodalManifestEnhancer,
        nodes,
        objectStorage,
        outlines,
        parseArtifacts,
        paths,
        ...(context.subject.tenantId ? { tenantId: context.subject.tenantId } : {}),
      });
    },
    degradation: { strategy: "fail-closed" },
    estimateCost: () => ({ estimatedRows: 2 }),
    inputSchema: KnowledgeFsReadCommandInputSchema,
    name: "cat",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ input }) =>
      withKnowledgeFsPreviewResult(
        input,
        await statKnowledgeFsPath({
          artifactSegments,
          assets,
          input,
          nodes,
          parseArtifacts,
          paths,
        }),
      ),
    degradation: { strategy: "fail-closed" },
    estimateCost: () => ({ estimatedRows: 2 }),
    inputSchema: KnowledgeFsReadCommandInputSchema,
    name: "stat",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) =>
      withKnowledgeSpaceDocumentMutationLease({
        acquiredAt: documentMutationLeaseNow(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        mutate: () =>
          writeKnowledgeFsDocument({
            assets,
            deletionFence,
            input,
            mode: "write",
            multimodalManifestEnhancer,
            objectWriteAdmission,
            objectStorage,
            outlines,
            parseArtifacts,
            paths,
            subject: context.subject,
          }),
        operation: "knowledge-fs-write",
        repository: documentMutationAdmissionGuard,
        tenantId: context.subject.tenantId,
      }),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedBytes: new TextEncoder().encode(input.text).length }),
    inputSchema: KnowledgeFsWriteCommandInputSchema,
    name: "write",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:write"),
    supportedResourceTypes: ["workspace"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) =>
      withKnowledgeSpaceDocumentMutationLease({
        acquiredAt: documentMutationLeaseNow(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        mutate: () =>
          writeKnowledgeFsDocument({
            assets,
            deletionFence,
            input,
            mode: "append",
            multimodalManifestEnhancer,
            objectWriteAdmission,
            objectStorage,
            outlines,
            parseArtifacts,
            paths,
            subject: context.subject,
          }),
        operation: "knowledge-fs-write",
        repository: documentMutationAdmissionGuard,
        tenantId: context.subject.tenantId,
      }),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedBytes: new TextEncoder().encode(input.text).length }),
    inputSchema: KnowledgeFsWriteCommandInputSchema,
    name: "append",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:write"),
    supportedResourceTypes: ["workspace"],
  });

  return registry;
}

function assertKnowledgeFsCommandConsistency(
  commandName: CommandName,
  consistencyClass: KnowledgeSpaceConsistencyClass | undefined,
): void {
  if (
    consistencyClass === "eventual-preview" &&
    EVENTUAL_PREVIEW_UNSUPPORTED_COMMANDS.has(commandName)
  ) {
    throw new KnowledgeFsValidationError(
      `KnowledgeFS command ${commandName} does not support eventual-preview consistency`,
    );
  }
}

function withKnowledgeFsPreviewResult<TOutput extends object>(
  input: { readonly consistencyClass?: KnowledgeSpaceConsistencyClass | undefined },
  output: TOutput,
): TOutput {
  if (input.consistencyClass !== "eventual-preview") {
    return output;
  }

  return {
    ...output,
    consistencyClass: "eventual-preview",
    preview: true,
  };
}

async function listKnowledgeFsDirectory({
  artifactSegments,
  assets,
  graph,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly graph: GraphIndexRepository;
  readonly input: Omit<KnowledgeFsCommandInput, "depth">;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsListResult> {
  if (isKnowledgeFsByEntityPath(input.path)) {
    return listKnowledgeFsByEntity({
      assets,
      graph,
      input,
      nodes,
    });
  }

  if (isKnowledgeFsByTopicPath(input.path)) {
    return listKnowledgeFsByTopic({
      artifactSegments,
      assets,
      input,
      nodes,
      parseArtifacts,
      paths,
    });
  }

  if (isKnowledgeFsByCommunityPath(input.path)) {
    return listKnowledgeFsByCommunity({
      artifactSegments,
      assets,
      input,
      nodes,
      parseArtifacts,
      paths,
    });
  }

  const parsedPath = parseKnowledgeFsPhysicalPath(input.path);
  const result = await listCandidateReadablePathPage({
    artifactSegments,
    assets,
    ...(input.cursor ? { cursor: decodeKnowledgePathCursor(input.cursor) } : {}),
    candidateInput: input,
    listPage: ({ cursor, limit }) =>
      paths.listPhysicalDescendants({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit,
        parentPath: parsedPath.path,
        viewName: parsedPath.viewName,
      }),
    nodes,
    parseArtifacts,
  });

  return {
    items: buildKnowledgeFsEntries(parsedPath.path, result.items),
    ...(result.nextCursor ? { nextCursor: encodeKnowledgePathCursor(result.nextCursor) } : {}),
    path: parsedPath.path,
    truncated: Boolean(result.nextCursor),
  };
}

async function listKnowledgeFsByCommunity({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: Omit<KnowledgeFsCommandInput, "depth">;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsListResult> {
  const normalizedPath = normalizeKnowledgeFsPath(input.path);
  assertKnowledgeFsByCommunityListPath(normalizedPath);
  const result = await listCandidateReadablePathPage({
    artifactSegments,
    assets,
    ...(input.cursor ? { cursor: decodeKnowledgePathCursor(input.cursor) } : {}),
    candidateInput: input,
    listPage: ({ cursor, limit }) =>
      paths.listSemanticDescendants({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit,
        parentPath: normalizedPath,
        viewName: KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME,
      }),
    nodes,
    parseArtifacts,
  });

  return {
    items: buildKnowledgeFsSemanticEntries(normalizedPath, result.items),
    ...(result.nextCursor ? { nextCursor: encodeKnowledgePathCursor(result.nextCursor) } : {}),
    path: normalizedPath,
    truncated: Boolean(result.nextCursor),
  };
}

async function listKnowledgeFsByEntity({
  assets,
  graph,
  input,
  nodes,
}: {
  readonly assets: DocumentAssetRepository;
  readonly graph: GraphIndexRepository;
  readonly input: Omit<KnowledgeFsCommandInput, "depth">;
  readonly nodes: KnowledgeNodeRepository;
}): Promise<KnowledgeFsListResult> {
  const normalizedPath = normalizeKnowledgeFsPath(input.path);
  const entityId = knowledgeFsByEntityIdFromPath(normalizedPath);

  if (!entityId) {
    const result = await listCandidateReadableGraphEntities({ assets, graph, input, nodes });

    return {
      items: result.items.map((entity) => ({
        kind: "directory",
        metadata: {
          entityId: entity.id,
          semanticView: cloneJsonObject(LIVE_SEMANTIC_VIEW_METADATA),
          sourceNodeCount: entity.sourceNodeIds.length,
          type: entity.type,
        },
        name: entity.name,
        path: `${KNOWLEDGE_FS_BY_ENTITY_ROOT}/${encodeURIComponent(entity.id)}`,
        targetId: entity.id,
      })),
      ...(result.nextCursor ? { nextCursor: encodeGraphEntityCursor(result.nextCursor) } : {}),
      path: normalizedPath,
      truncated: Boolean(result.nextCursor),
    };
  }

  const traversal = await graph.traverse({
    fanout: input.limit,
    knowledgeSpaceId: input.knowledgeSpaceId,
    maxDepth: 2,
    maxNodes: Math.max(input.limit * 4, input.limit),
    permissionScope: candidateGrants(input),
    startEntityId: entityId,
    timeoutMs: 250,
  });
  const sourceNodeIds = uniqueStrings(traversal.entities.flatMap((entity) => entity.sourceNodeIds));
  const loadedNodes =
    sourceNodeIds.length === 0
      ? []
      : await nodes.getMany({
          ids: sourceNodeIds.slice(0, Math.max(input.limit * 4, input.limit)),
          knowledgeSpaceId: input.knowledgeSpaceId,
        });
  const documents = new Map<
    string,
    { readonly documentAssetId: string; readonly nodeIds: string[] }
  >();

  for (const node of loadedNodes) {
    if (!(await isCandidateReadableNodeWithAsset({ assets, input, node }))) {
      continue;
    }
    const existing = documents.get(node.documentAssetId) ?? {
      documentAssetId: node.documentAssetId,
      nodeIds: [],
    };
    documents.set(node.documentAssetId, {
      documentAssetId: node.documentAssetId,
      nodeIds: uniqueStrings([...existing.nodeIds, node.id]),
    });
  }

  const items = Array.from(documents.values())
    .sort((left, right) => left.documentAssetId.localeCompare(right.documentAssetId))
    .slice(0, input.limit)
    .map(
      (document): KnowledgeFsEntry => ({
        kind: "resource",
        metadata: {
          entityId,
          nodeIds: [...document.nodeIds],
          semanticView: cloneJsonObject(LIVE_SEMANTIC_VIEW_METADATA),
        },
        name: document.documentAssetId,
        path: `${normalizedPath}/${document.documentAssetId}`,
        resourceType: "document",
        targetId: document.documentAssetId,
      }),
    );

  return {
    items,
    path: normalizedPath,
    truncated: documents.size > input.limit,
  };
}

async function listCandidateReadableGraphEntities({
  assets,
  graph,
  input,
  nodes,
}: {
  readonly assets: DocumentAssetRepository;
  readonly graph: GraphIndexRepository;
  readonly input: Omit<KnowledgeFsCommandInput, "depth">;
  readonly nodes: KnowledgeNodeRepository;
}): Promise<{ readonly items: GraphEntity[]; readonly nextCursor?: GraphEntityCursor }> {
  const readable: GraphEntity[] = [];
  let scanCursor = input.cursor ? decodeGraphEntityCursor(input.cursor) : undefined;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < KNOWLEDGE_FS_MAX_SCAN_PAGES; scannedPages += 1) {
    const page = await graph.listEntities({
      ...(scanCursor ? { cursor: scanCursor } : {}),
      knowledgeSpaceId: input.knowledgeSpaceId,
      limit: input.limit,
    });
    for (const entity of page.items) {
      if (await isCandidateReadableGraphEntity({ assets, entity, input, nodes })) {
        readable.push(entity);
      }
    }
    if (readable.length > input.limit) {
      break;
    }
    if (!page.nextCursor) {
      reachedEnd = true;
      break;
    }
    scanCursor = page.nextCursor;
  }

  const items = readable.slice(0, input.limit);
  const lastItem = items.at(-1);
  if (readable.length <= input.limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }
  return {
    items,
    ...(readable.length > input.limit && lastItem
      ? { nextCursor: { id: lastItem.id, name: lastItem.name } }
      : {}),
  };
}

async function isCandidateReadableGraphEntity({
  assets,
  entity,
  input,
  nodes,
}: {
  readonly assets: DocumentAssetRepository;
  readonly entity: GraphEntity;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly nodes: KnowledgeNodeRepository;
}): Promise<boolean> {
  if (!candidatePermissionScopeAllows(entity.permissionScope, candidateGrants(input))) {
    return false;
  }

  const sourceNodeIds = boundedPermissionClosureIds(entity.sourceNodeIds);
  if (!sourceNodeIds) {
    return false;
  }

  const sourceNodes = await Promise.all(
    sourceNodeIds.map((id) => nodes.get({ id, knowledgeSpaceId: entity.knowledgeSpaceId })),
  );
  if (sourceNodes.some((node) => !node)) {
    return false;
  }

  return (
    await Promise.all(
      sourceNodes.map((node) =>
        node ? isCandidateReadableNodeWithAsset({ assets, input, node }) : Promise.resolve(false),
      ),
    )
  ).every(Boolean);
}

async function listKnowledgeFsByTopic({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: Omit<KnowledgeFsCommandInput, "depth">;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsListResult> {
  const normalizedPath = normalizeKnowledgeFsPath(input.path);
  assertKnowledgeFsByTopicListPath(normalizedPath);
  const result = await listCandidateReadablePathPage({
    artifactSegments,
    assets,
    ...(input.cursor ? { cursor: decodeKnowledgePathCursor(input.cursor) } : {}),
    candidateInput: input,
    listPage: ({ cursor, limit }) =>
      paths.listSemanticDescendants({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit,
        parentPath: normalizedPath,
        viewName: KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
      }),
    nodes,
    parseArtifacts,
  });

  return {
    items: buildKnowledgeFsSemanticEntries(normalizedPath, result.items),
    ...(result.nextCursor ? { nextCursor: encodeKnowledgePathCursor(result.nextCursor) } : {}),
    path: normalizedPath,
    truncated: Boolean(result.nextCursor),
  };
}

async function findKnowledgeFsPaths({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsFindCommandInput;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsListResult> {
  if (
    (input.metadataKey === undefined && input.metadataValue !== undefined) ||
    (input.metadataKey !== undefined && input.metadataValue === undefined)
  ) {
    throw new KnowledgeFsValidationError(
      "KnowledgeFS find metadataKey and metadataValue must be provided together",
    );
  }

  const exactPath = await paths.get({
    knowledgeSpaceId: input.knowledgeSpaceId,
    virtualPath: normalizeKnowledgeFsPath(input.path),
  });

  if (exactPath?.resourceType === "artifact") {
    await assertCandidateCanReadPath({
      artifactSegments,
      assets,
      input,
      nodes,
      parseArtifacts,
      path: exactPath,
    });
    return findArtifactSegments({ artifactSegments, input, path: exactPath });
  }

  if (exactPath && knowledgePathMatchesFind(exactPath, input)) {
    await assertCandidateCanReadPath({
      artifactSegments,
      assets,
      input,
      nodes,
      parseArtifacts,
      path: exactPath,
    });
    return {
      items: [knowledgePathToResourceEntry(exactPath)],
      path: exactPath.virtualPath,
      truncated: false,
    };
  }

  const parsedPath = parseKnowledgeFsPhysicalPath(input.path);
  const matches = await collectMatchingPhysicalPaths({
    input,
    match: async (path) =>
      knowledgePathMatchesFind(path, input) &&
      (await isCandidateReadablePath({
        artifactSegments,
        assets,
        input,
        nodes,
        parseArtifacts,
        path,
      })),
    parentPath: parsedPath.path,
    paths,
    viewName: parsedPath.viewName,
  });
  const page = matches.items.slice(0, input.limit);
  const lastPageMatch = page.at(-1);
  const nextCursor =
    matches.items.length > input.limit && lastPageMatch
      ? encodeKnowledgePathCursor(knowledgePathCursor(lastPageMatch))
      : matches.nextCursor
        ? encodeKnowledgePathCursor(matches.nextCursor)
        : undefined;

  return {
    items: page.map(knowledgePathToResourceEntry),
    ...(nextCursor ? { nextCursor } : {}),
    path: parsedPath.path,
    truncated: Boolean(nextCursor),
  };
}

async function findArtifactSegments({
  artifactSegments,
  input,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly input: KnowledgeFsFindCommandInput;
  readonly path: KnowledgePath;
}): Promise<KnowledgeFsListResult> {
  const result = await artifactSegments.listByArtifact({
    ...(input.cursor ? { cursor: decodeArtifactSegmentCursor(input.cursor) } : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: input.limit + 1,
    parseArtifactId: path.targetId,
  });
  const matches = result.items.filter((segment) => artifactSegmentMatchesFind(segment, input));
  const page = matches.slice(0, input.limit);
  const lastPageSegment = page.at(-1);
  const nextCursor =
    matches.length > input.limit && lastPageSegment
      ? String(lastPageSegment.segmentIndex)
      : result.nextCursor === undefined
        ? undefined
        : String(result.nextCursor);

  return {
    items: page.map((segment) => ({
      kind: "resource",
      metadata: {
        ...cloneJsonObject(segment.metadata),
        segmentIndex: segment.segmentIndex,
        segmentType: segment.segmentType,
      },
      name: `segment-${segment.segmentIndex}`,
      path: `${path.virtualPath}#segment-${segment.segmentIndex}`,
      resourceType: "artifact",
      targetId: segment.id,
    })),
    ...(nextCursor ? { nextCursor } : {}),
    path: path.virtualPath,
    truncated: Boolean(nextCursor),
  };
}

async function collectMatchingPhysicalPaths({
  input,
  match,
  parentPath,
  paths,
  viewName,
}: {
  readonly input: Pick<KnowledgeFsCommandInput, "cursor" | "knowledgeSpaceId" | "limit">;
  readonly match: (path: KnowledgePath) => boolean | Promise<boolean>;
  readonly parentPath: string;
  readonly paths: KnowledgePathRepository;
  readonly viewName: string;
}): Promise<{ readonly items: KnowledgePath[]; readonly nextCursor?: KnowledgePathCursor }> {
  const matches: KnowledgePath[] = [];
  let cursor = input.cursor ? decodeKnowledgePathCursor(input.cursor) : undefined;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < KNOWLEDGE_FS_MAX_SCAN_PAGES; scannedPages += 1) {
    const result = await paths.listPhysicalDescendants({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: input.knowledgeSpaceId,
      limit: input.limit,
      parentPath,
      viewName,
    });

    for (const path of result.items) {
      if (await match(path)) {
        matches.push(path);

        if (matches.length > input.limit) {
          break;
        }
      }
    }

    if (matches.length > input.limit) {
      break;
    }
    if (!result.nextCursor) {
      reachedEnd = true;
      break;
    }

    cursor = result.nextCursor;
  }

  if (matches.length <= input.limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }

  return {
    items: matches,
  };
}

function artifactSegmentMatchesFind(
  segment: Awaited<ReturnType<ArtifactSegmentRepository["listByArtifact"]>>["items"][number],
  input: KnowledgeFsFindCommandInput,
): boolean {
  if (input.resourceType && input.resourceType !== "artifact") {
    return false;
  }

  if (input.nameContains && !`segment-${segment.segmentIndex}`.includes(input.nameContains)) {
    return false;
  }

  if (input.metadataKey && input.metadataValue) {
    const value = segment.metadata[input.metadataKey];

    return typeof value === "string"
      ? value === input.metadataValue
      : JSON.stringify(value) === input.metadataValue;
  }

  return true;
}

async function grepKnowledgeFsPath({
  artifactSegments,
  assets,
  input,
  multimodalManifestEnhancer,
  nodes,
  objectStorage,
  outlines,
  parseArtifacts,
  paths,
  tenantId,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsGrepCommandInput;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly tenantId?: string | undefined;
}): Promise<KnowledgeFsGrepResult> {
  const exactPath = await paths.get({
    knowledgeSpaceId: input.knowledgeSpaceId,
    virtualPath: normalizeKnowledgeFsPath(input.path),
  });

  if (exactPath?.resourceType === "artifact") {
    return grepArtifactSegments({
      artifactSegments,
      assets,
      input,
      objectStorage,
      parseArtifacts,
      path: exactPath,
    });
  }

  if (exactPath?.resourceType === "document" || exactPath?.resourceType === "node") {
    const match = await grepKnowledgePathResource({
      assets,
      denyUnauthorized: true,
      input,
      multimodalManifestEnhancer,
      nodes,
      objectStorage,
      outlines,
      parseArtifacts,
      path: exactPath,
      ...(tenantId ? { tenantId } : {}),
    });

    return {
      matches: match ? [match] : [],
      path: exactPath.virtualPath,
      truncated: false,
    };
  }

  const startedAt = Date.now();
  const parsedPath = parseKnowledgeFsPhysicalPath(input.path);
  const matches: Array<KnowledgeFsGrepMatch & { readonly cursor: KnowledgePathCursor }> = [];
  let cursor = input.cursor ? decodeKnowledgePathCursor(input.cursor) : undefined;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < KNOWLEDGE_FS_MAX_SCAN_PAGES; scannedPages += 1) {
    /* v8 ignore next 3 -- timeout is a production guard for slow stores and is timing-sensitive in unit tests. */
    if (input.timeoutMs !== undefined && Date.now() - startedAt > input.timeoutMs) {
      break;
    }

    const result = await paths.listPhysicalDescendants({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId: input.knowledgeSpaceId,
      limit: input.limit,
      parentPath: parsedPath.path,
      viewName: parsedPath.viewName,
    });

    for (const path of result.items) {
      if (path.resourceType !== "document" && path.resourceType !== "node") {
        continue;
      }

      let match: KnowledgeFsGrepMatch | null;
      try {
        match = await grepKnowledgePathResource({
          assets,
          input,
          multimodalManifestEnhancer,
          nodes,
          objectStorage,
          outlines,
          parseArtifacts,
          path,
          ...(tenantId ? { tenantId } : {}),
        });
      } catch (error) {
        if (error instanceof KnowledgeFsNotFoundError) {
          continue;
        }
        throw error;
      }

      if (match) {
        matches.push({ ...match, cursor: knowledgePathCursor(path) });

        if (matches.length > input.limit) {
          break;
        }
      }
    }

    if (matches.length > input.limit) {
      break;
    }
    if (!result.nextCursor) {
      reachedEnd = true;
      break;
    }

    cursor = result.nextCursor;
  }

  if (matches.length <= input.limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }

  const page = matches.slice(0, input.limit);
  const lastPageMatch = page.at(-1);
  const nextCursor =
    matches.length > input.limit && lastPageMatch
      ? encodeKnowledgePathCursor(lastPageMatch.cursor)
      : undefined;

  return {
    matches: page.map(({ cursor: _cursor, ...match }) => match),
    ...(nextCursor ? { nextCursor } : {}),
    path: parsedPath.path,
    truncated: Boolean(nextCursor),
  };
}

async function grepKnowledgePathResource({
  assets,
  denyUnauthorized = false,
  input,
  multimodalManifestEnhancer,
  nodes,
  objectStorage,
  outlines,
  parseArtifacts,
  path,
  tenantId,
}: {
  readonly assets: DocumentAssetRepository;
  readonly denyUnauthorized?: boolean | undefined;
  readonly input: KnowledgeFsGrepCommandInput;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
  readonly tenantId?: string | undefined;
}): Promise<KnowledgeFsGrepMatch | null> {
  assertCandidatePermissionScopeAllowsPath(path, input);
  if (path.resourceType === "node") {
    const node = await nodes.get({
      id: path.targetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });

    /* v8 ignore next 3 -- path/node drift is defensive; normal repositories keep node paths consistent. */
    if (!node) {
      return null;
    }
    if (!(await isCandidateReadableNodeWithAsset({ assets, input, node }))) {
      if (denyUnauthorized) {
        throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
      }
      return null;
    }

    return grepText({
      kind: "node",
      metadata: path.metadata,
      nodeId: node.id,
      path: path.virtualPath,
      query: input.q,
      text: node.text,
    });
  }

  if (path.resourceType !== "document") {
    return null;
  }

  const content = await readDocumentText({
    assets,
    input,
    multimodalManifestEnhancer,
    objectStorage,
    outlines,
    parseArtifacts,
    path,
    ...(tenantId ? { tenantId } : {}),
  });

  if (!content) {
    return null;
  }

  return grepText({
    kind: "segment",
    metadata: path.metadata,
    path: path.virtualPath,
    query: input.q,
    text: content.text,
  });
}

function grepText({
  kind,
  metadata,
  nodeId,
  path,
  query,
  text,
}: {
  readonly kind: KnowledgeFsGrepMatch["kind"];
  readonly metadata: Record<string, unknown>;
  readonly nodeId?: string | undefined;
  readonly path: string;
  readonly query: string;
  readonly text: string;
}): KnowledgeFsGrepMatch | null {
  const startOffset = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());

  if (startOffset < 0) {
    return null;
  }

  return {
    endOffset: startOffset + query.length,
    kind,
    metadata: cloneJsonObject(metadata),
    ...(nodeId ? { nodeId } : {}),
    path,
    snippet: text,
    startOffset,
  };
}

async function grepArtifactSegments({
  artifactSegments,
  assets,
  input,
  objectStorage,
  parseArtifacts,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsGrepCommandInput;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
}): Promise<KnowledgeFsGrepResult> {
  assertCandidatePermissionScopeAllowsPath(path, input);
  await assertCandidateCanReadArtifact({
    artifactSegments,
    assets,
    input,
    parseArtifacts,
    path,
  });
  const result = await artifactSegments.listByArtifact({
    ...(input.cursor ? { cursor: decodeArtifactSegmentCursor(input.cursor) } : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: input.limit + 1,
    parseArtifactId: path.targetId,
  });
  const matches: KnowledgeFsGrepMatch[] = [];
  const query = input.q.toLocaleLowerCase();

  for (const segment of result.items) {
    const text = await readArtifactSegmentText({ objectStorage, segment });
    const relativeOffset = text.toLocaleLowerCase().indexOf(query);

    if (relativeOffset < 0) {
      continue;
    }

    const baseOffset = segment.startOffset ?? 0;
    matches.push({
      endOffset: baseOffset + relativeOffset + input.q.length,
      kind: "segment",
      metadata: cloneJsonObject(segment.metadata),
      path: path.virtualPath,
      segmentId: segment.id,
      snippet: text,
      startOffset: baseOffset + relativeOffset,
    });
  }

  const page = matches.slice(0, input.limit);
  const lastMatch = page.at(-1);
  const nextCursor =
    matches.length > input.limit && lastMatch?.segmentId
      ? String(result.items.find((segment) => segment.id === lastMatch.segmentId)?.segmentIndex)
      : result.nextCursor === undefined
        ? undefined
        : String(result.nextCursor);

  return {
    matches: page,
    ...(nextCursor ? { nextCursor } : {}),
    path: path.virtualPath,
    truncated: Boolean(nextCursor),
  };
}

async function diffKnowledgeFsPaths({
  assets,
  artifactSegments,
  compute,
  input,
  multimodalManifestEnhancer,
  nodes,
  objectStorage,
  outlines,
  parseArtifacts,
  paths,
  semanticDiffProvider,
  tenantId,
}: {
  readonly assets: DocumentAssetRepository;
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly compute: ComputeRuntime;
  readonly input: KnowledgeFsDiffCommandInput;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly semanticDiffProvider?: SemanticDiffProvider | undefined;
  readonly tenantId?: string | undefined;
}): Promise<KnowledgeFsDiffResult> {
  const [oldContent, newContent] = await Promise.all([
    catKnowledgeFsPath({
      assets,
      artifactSegments,
      input: {
        candidatePermissionScope: input.candidatePermissionScope,
        knowledgeSpaceId: input.knowledgeSpaceId,
        path: input.oldPath,
      },
      nodes,
      multimodalManifestEnhancer,
      objectStorage,
      outlines,
      parseArtifacts,
      paths,
      ...(tenantId ? { tenantId } : {}),
    }),
    catKnowledgeFsPath({
      assets,
      artifactSegments,
      input: {
        candidatePermissionScope: input.candidatePermissionScope,
        knowledgeSpaceId: input.knowledgeSpaceId,
        path: input.newPath,
      },
      nodes,
      multimodalManifestEnhancer,
      objectStorage,
      outlines,
      parseArtifacts,
      paths,
      ...(tenantId ? { tenantId } : {}),
    }),
  ]);
  const mode = input.mode ?? "line";
  const diff = compute.diffText({
    config: { mode },
    newText: newContent.text,
    oldText: oldContent.text,
  });
  const operations = diff.operations.map(cloneTextDiffOperation);
  const stats = { ...diff.stats };
  const semantic =
    input.semantic === "true"
      ? await summarizeKnowledgeFsSemanticDiff({
          mode,
          newContent,
          oldContent,
          operations,
          semanticDiffProvider,
          stats,
        })
      : undefined;

  return {
    mode,
    newPath: newContent.path,
    oldPath: oldContent.path,
    operations,
    ...(semantic ? { semantic } : {}),
    stats,
  };
}

async function summarizeKnowledgeFsSemanticDiff({
  mode,
  newContent,
  oldContent,
  operations,
  semanticDiffProvider,
  stats,
}: {
  readonly mode: "line" | "word";
  readonly newContent: KnowledgeFsCatResult;
  readonly oldContent: KnowledgeFsCatResult;
  readonly operations: readonly TextDiffOperation[];
  readonly semanticDiffProvider?: SemanticDiffProvider | undefined;
  readonly stats: TextDiff["stats"];
}): Promise<SemanticDiffSummary> {
  if (!semanticDiffProvider) {
    throw new KnowledgeFsUnavailableError("KnowledgeFS semantic diff provider is not configured");
  }

  const result = await semanticDiffProvider.summarize({
    mode,
    newPath: newContent.path,
    newText: newContent.text,
    oldPath: oldContent.path,
    oldText: oldContent.text,
    operations: operations.map(cloneTextDiffOperation),
    stats: { ...stats },
  });

  const parsed = SemanticDiffSummarySchema.safeParse(result);

  if (!parsed.success) {
    throw new KnowledgeFsUnavailableError(
      "KnowledgeFS semantic diff provider returned invalid output",
    );
  }

  return cloneSemanticDiffSummary(parsed.data);
}

function cloneSemanticDiffSummary(summary: SemanticDiffSummary): SemanticDiffSummary {
  return {
    changes: summary.changes.map((change) => ({
      category: change.category,
      evidence: [...change.evidence],
      summary: change.summary,
    })),
    metadata: cloneJsonObject(summary.metadata),
    ...(summary.model ? { model: summary.model } : {}),
    summary: summary.summary,
  };
}

async function openKnowledgeFsNode({
  assets,
  input,
  nodes,
}: {
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsOpenNodeCommandInput;
  readonly nodes: KnowledgeNodeRepository;
}): Promise<KnowledgeFsOpenNodeResult> {
  const node = await nodes.get({
    id: input.nodeId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });

  if (!node || !(await isCandidateReadableNodeWithAsset({ assets, input, node }))) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS node not found");
  }

  return {
    citation: {
      artifactHash: node.artifactHash,
      documentAssetId: node.documentAssetId,
      endOffset: node.sourceLocation.endOffset ?? node.endOffset,
      ...(node.sourceLocation.pageNumber ? { pageNumber: node.sourceLocation.pageNumber } : {}),
      parseArtifactId: node.parseArtifactId,
      sectionPath: [...node.sourceLocation.sectionPath],
      startOffset: node.sourceLocation.startOffset ?? node.startOffset,
    },
    node: cloneKnowledgeNode(node),
  };
}

async function catKnowledgeFsPath({
  assets,
  artifactSegments,
  input,
  multimodalManifestEnhancer,
  nodes,
  objectStorage,
  outlines,
  parseArtifacts,
  paths,
  tenantId,
}: {
  readonly assets: DocumentAssetRepository;
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly input: KnowledgeFsReadCommandInput;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly tenantId?: string | undefined;
}): Promise<KnowledgeFsCatResult> {
  const path = await resolveKnowledgeFsPath(paths, input);
  await assertCandidateCanReadPath({
    artifactSegments,
    assets,
    input,
    nodes,
    parseArtifacts,
    path,
  });

  if (path.resourceType === "document") {
    const content = await readDocumentText({
      assets,
      input,
      multimodalManifestEnhancer,
      objectStorage,
      outlines,
      parseArtifacts,
      path,
      ...(tenantId ? { tenantId } : {}),
    });

    if (content) {
      return {
        contentType: content.contentType,
        path: path.virtualPath,
        text: content.text,
        truncated: false,
      };
    }

    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  if (path.resourceType === "node") {
    const node = await nodes.get({
      id: path.targetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });

    if (!node || !(await isCandidateReadableNodeWithAsset({ assets, input, node }))) {
      throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
    }

    if (node.kind === "table" && isHtmlKnowledgeFsTablePath(path)) {
      return {
        contentType: "text/html",
        path: path.virtualPath,
        text: renderKnowledgeFsTableHtml(node),
        truncated: false,
      };
    }

    if (node.kind === "image") {
      return {
        contentType: "text/markdown",
        path: path.virtualPath,
        text: renderKnowledgeFsImageMarkdown(node),
        truncated: false,
      };
    }

    return {
      contentType: node.kind === "table" ? "application/json" : "text/markdown",
      path: path.virtualPath,
      text: node.text,
      truncated: false,
    };
  }

  if (path.resourceType === "artifact") {
    await assertCandidateCanReadArtifact({
      artifactSegments,
      assets,
      input,
      parseArtifacts,
      path,
    });
    const result = await artifactSegments.listByArtifact({
      ...(input.cursor ? { cursor: decodeArtifactSegmentCursor(input.cursor) } : {}),
      knowledgeSpaceId: input.knowledgeSpaceId,
      limit: input.limit ?? 100,
      parseArtifactId: path.targetId,
    });

    if (
      result.items.length === 0 &&
      !(await artifactHasSegments({ artifactSegments, input, path }))
    ) {
      return catLegacyParseArtifact({ input, parseArtifacts, path });
    }

    if (result.items.length === 0) {
      throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
    }

    const text = (
      await Promise.all(
        result.items.map((segment) => readArtifactSegmentText({ objectStorage, segment })),
      )
    ).join("");
    const nextCursor = result.nextCursor === undefined ? undefined : String(result.nextCursor);

    return {
      contentType:
        typeof path.metadata.contentType === "string" ? path.metadata.contentType : "text/plain",
      ...(nextCursor ? { nextCursor } : {}),
      path: path.virtualPath,
      text,
      truncated: Boolean(nextCursor),
    };
  }

  throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
}

async function writeKnowledgeFsDocument({
  assets,
  deletionFence,
  input,
  mode,
  multimodalManifestEnhancer,
  objectWriteAdmission,
  objectStorage,
  outlines,
  parseArtifacts,
  paths,
  subject,
}: {
  readonly assets: DocumentAssetRepository;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly input: KnowledgeFsWriteCommandInput;
  readonly mode: KnowledgeFsWriteResult["mode"];
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
  readonly subject: AuthSubject;
}): Promise<KnowledgeFsWriteResult> {
  const virtualPath = normalizeKnowledgeFsPath(input.path);
  const parsedPath = parseKnowledgeFsPhysicalPath(virtualPath);

  if (parsedPath.viewName !== "docs" || parsedPath.path === "/knowledge/docs") {
    throw new KnowledgeFsValidationError(
      "KnowledgeFS write path must be a file under /knowledge/docs",
    );
  }

  const filename = filenameFromKnowledgeFsPath(parsedPath.path);
  const existingPath = await paths.get({
    knowledgeSpaceId: input.knowledgeSpaceId,
    virtualPath: parsedPath.path,
  });

  if (existingPath && existingPath.resourceType !== "document") {
    throw new KnowledgeFsValidationError("KnowledgeFS write path must target a document");
  }

  const existingAsset = existingPath
    ? await assets.get({
        id: existingPath.targetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      })
    : null;
  if (existingPath) {
    assertCandidatePermissionScopeAllowsPath(existingPath, input);
    if (!existingAsset || !candidatePermissionAllowsAsset(existingAsset, candidateGrants(input))) {
      throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
    }
  }

  const existingText =
    mode === "append" && existingPath
      ? ((
          await readDocumentText({
            assets,
            input: {
              candidatePermissionScope: input.candidatePermissionScope,
              knowledgeSpaceId: input.knowledgeSpaceId,
              path: existingPath.virtualPath,
            },
            multimodalManifestEnhancer,
            objectStorage,
            outlines,
            parseArtifacts,
            path: existingPath,
            tenantId: subject.tenantId,
          })
        )?.text ?? "")
      : "";
  const text = mode === "append" ? `${existingText}${input.text}` : input.text;
  const body = new TextEncoder().encode(text);
  const assetId = randomUUID();
  const mimeType = inferWritableDocumentMimeType(filename);
  const objectKey = createDocumentObjectKey({
    assetId,
    filename,
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: subject.tenantId,
  });
  const deletionToken = await deletionFence?.captureDeletionFence({
    documentAssetId: assetId,
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: subject.tenantId,
  });
  const assertWritable = async (): Promise<void> => {
    if (deletionToken) await deletionFence?.assertDeletionFenceUnchanged(deletionToken);
  };
  let createdAsset: Awaited<ReturnType<DocumentAssetRepository["create"]>> | undefined;

  try {
    await assertWritable();
    await withDeletionObjectWriteAdmission(
      objectWriteAdmission,
      { knowledgeSpaceId: input.knowledgeSpaceId, tenantId: subject.tenantId },
      () =>
        objectStorage.putObject({
          body,
          contentType: mimeType,
          key: objectKey,
          metadata: {
            command: mode,
            knowledgeSpaceId: input.knowledgeSpaceId,
            tenantId: subject.tenantId,
            writtenBy: subject.subjectId,
          },
        }),
    );
    await assertWritable();

    const asset = await assets.create({
      filename,
      id: assetId,
      knowledgeSpaceId: input.knowledgeSpaceId,
      metadata: {
        command: mode,
        ...(Array.isArray(existingAsset?.metadata.permissionScope)
          ? { permissionScope: [...existingAsset.metadata.permissionScope] }
          : {}),
        tenantId: subject.tenantId,
        writtenBy: subject.subjectId,
      },
      mimeType,
      objectKey,
      sha256: sha256Hex(body),
      sizeBytes: body.byteLength,
      tenantId: subject.tenantId,
    });
    createdAsset = asset;
    await assertWritable();
    await assets.updateParserStatus({
      id: asset.id,
      knowledgeSpaceId: input.knowledgeSpaceId,
      parserStatus: "parsed",
    });
    await assertWritable();
    await paths.upsertMany([
      KnowledgePathSchema.parse({
        id: existingPath?.id ?? randomUUID(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: {
          filename,
          mimeType,
          objectKey,
          ...(Array.isArray(existingPath?.metadata.permissionScope)
            ? { permissionScope: [...existingPath.metadata.permissionScope] }
            : {}),
          tenantId: subject.tenantId,
        },
        resourceType: "document",
        targetId: asset.id,
        version: asset.version,
        viewName: parsedPath.viewName,
        viewType: "physical",
        virtualPath: parsedPath.path,
      }),
    ]);
    await assertWritable();

    return {
      bytesWritten: body.byteLength,
      mode,
      objectKey,
      path: parsedPath.path,
      targetId: asset.id,
      version: asset.version,
    };
  } catch (error) {
    let effectiveError = error;
    if (!isDeletionWriteBlocked(effectiveError)) {
      try {
        await assertWritable();
      } catch (fenceError) {
        effectiveError = fenceError;
      }
    }
    if (isDeletionWriteBlocked(effectiveError)) {
      if (createdAsset) {
        await assets
          .rollbackStaleWrite({
            expectedObjectKey: createdAsset.objectKey,
            expectedVersion: createdAsset.version,
            id: createdAsset.id,
            knowledgeSpaceId: input.knowledgeSpaceId,
          })
          .catch(() => undefined);
      }
      await objectStorage.deleteObject(objectKey).catch(() => undefined);
    }
    throw effectiveError;
  }
}

function isDeletionWriteBlocked(error: unknown): boolean {
  return (
    error instanceof DeletionLifecycleFenceActiveError ||
    error instanceof DeletionObjectWriteAdmissionError
  );
}

function filenameFromKnowledgeFsPath(path: string): string {
  const filename = path.split("/").at(-1)?.trim();

  if (!filename || filename === "." || filename === "..") {
    throw new KnowledgeFsValidationError("KnowledgeFS write path must include a filename");
  }

  return filename;
}

function inferWritableDocumentMimeType(filename: string): string {
  const lower = filename.toLocaleLowerCase();

  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }

  if (lower.endsWith(".json")) {
    return "application/json";
  }

  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    return "text/html";
  }

  if (lower.endsWith(".xml")) {
    return "application/xml";
  }

  return "text/plain";
}

function sha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

async function readDocumentText({
  assets,
  input,
  multimodalManifestEnhancer,
  objectStorage,
  outlines,
  parseArtifacts,
  path,
  tenantId,
}: {
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsReadCommandInput;
  readonly multimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer | undefined;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly outlines: DocumentOutlineRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
  readonly tenantId?: string | undefined;
}): Promise<{ readonly contentType: string; readonly text: string } | null> {
  assertCandidatePermissionScopeAllowsPath(path, input);
  const asset = await assets.get({
    id: path.targetId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });

  if (!asset) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  if (!candidatePermissionAllowsAsset(asset, candidateGrants(input))) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  if (path.metadata.contentKind === "document-outline") {
    const outline = await outlines.getByDocumentVersion({
      documentAssetId: asset.id,
      ...(path.publicationGenerationId
        ? { publicationGenerationId: path.publicationGenerationId }
        : {}),
      version: path.version ?? asset.version,
    });

    if (!outline) {
      return null;
    }

    return {
      contentType: "application/json",
      text: JSON.stringify(outline, null, 2),
    };
  }

  if (path.metadata.contentKind === "document-multimodal-manifest") {
    const artifact = await parseArtifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: path.version ?? asset.version,
    });

    if (!artifact) {
      return null;
    }

    const deterministicManifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      ...(path.publicationGenerationId
        ? { publicationGenerationId: path.publicationGenerationId }
        : {}),
    });
    const manifest = multimodalManifestEnhancer
      ? await multimodalManifestEnhancer.enhance({
          manifest: deterministicManifest,
          parseArtifact: artifact,
          ...(tenantId ? { tenantId } : {}),
        })
      : deterministicManifest;

    return {
      contentType: "application/json",
      text: JSON.stringify(manifest, null, 2),
    };
  }

  if (path.metadata.contentKind === "document-multimodal-asset") {
    const artifact = await parseArtifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: path.version ?? asset.version,
    });

    if (!artifact) {
      return null;
    }

    const itemId = metadataString(path.metadata, "itemId");
    if (!itemId) {
      return null;
    }

    const deterministicManifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      ...(path.publicationGenerationId
        ? { publicationGenerationId: path.publicationGenerationId }
        : {}),
    });
    const manifest = multimodalManifestEnhancer
      ? await multimodalManifestEnhancer.enhance({
          manifest: deterministicManifest,
          parseArtifact: artifact,
          ...(tenantId ? { tenantId } : {}),
        })
      : deterministicManifest;
    const item = manifest.items.find((candidate) => candidate.id === itemId);

    if (!item?.assetRef) {
      return null;
    }

    return {
      contentType: "application/json",
      text: JSON.stringify(
        {
          assetRef: item.assetRef,
          assetUrl: item.assetRef.objectKey
            ? `/knowledge-spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/multimodal/${encodeURIComponent(item.id)}/asset`
            : undefined,
          documentAssetId: asset.id,
          item,
          itemId: item.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          parseArtifactId: artifact.id,
          ...(item.assetRef.variants?.thumbnail
            ? {
                thumbnailAssetRef: item.assetRef.variants.thumbnail,
                thumbnailAssetUrl: `/knowledge-spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/multimodal/${encodeURIComponent(item.id)}/asset?variant=thumbnail`,
              }
            : {}),
          version: asset.version,
        },
        null,
        2,
      ),
    };
  }

  const multimodalDescriptorContentKind = metadataString(path.metadata, "contentKind");
  if (isDocumentMultimodalItemDescriptorContentKind(multimodalDescriptorContentKind)) {
    const artifact = await parseArtifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: path.version ?? asset.version,
    });

    if (!artifact) {
      return null;
    }

    const itemId = metadataString(path.metadata, "itemId");
    if (!itemId) {
      return null;
    }

    const deterministicManifest = createDocumentMultimodalManifestBuilder().build({
      artifact,
      knowledgeSpaceId: asset.knowledgeSpaceId,
      ...(path.publicationGenerationId
        ? { publicationGenerationId: path.publicationGenerationId }
        : {}),
    });
    const manifest = multimodalManifestEnhancer
      ? await multimodalManifestEnhancer.enhance({
          manifest: deterministicManifest,
          parseArtifact: artifact,
          ...(tenantId ? { tenantId } : {}),
        })
      : deterministicManifest;
    const item = manifest.items.find((candidate) => candidate.id === itemId);

    if (!item) {
      return null;
    }

    return {
      contentType: "application/json",
      text: JSON.stringify(
        {
          ...(item.assetRef ? { assetRef: item.assetRef } : {}),
          ...(item.assetRef?.objectKey
            ? {
                assetUrl: `/knowledge-spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/multimodal/${encodeURIComponent(item.id)}/asset`,
              }
            : {}),
          documentAssetId: asset.id,
          item,
          itemId: item.id,
          knowledgeSpaceId: asset.knowledgeSpaceId,
          parseArtifactId: artifact.id,
          resourceKind: documentMultimodalItemDescriptorResourceKind(
            multimodalDescriptorContentKind,
          ),
          ...(item.assetRef?.variants?.thumbnail
            ? {
                thumbnailAssetRef: item.assetRef.variants.thumbnail,
                thumbnailAssetUrl: `/knowledge-spaces/${asset.knowledgeSpaceId}/documents/${asset.id}/multimodal/${encodeURIComponent(item.id)}/asset?variant=thumbnail`,
              }
            : {}),
          version: asset.version,
        },
        null,
        2,
      ),
    };
  }

  if (path.metadata.contentKind === "document-section") {
    const outline = await outlines.getByDocumentVersion({
      documentAssetId: asset.id,
      ...(path.publicationGenerationId
        ? { publicationGenerationId: path.publicationGenerationId }
        : {}),
      version: path.version ?? asset.version,
    });
    const artifact = await parseArtifacts.getByDocumentVersion({
      documentAssetId: asset.id,
      version: path.version ?? asset.version,
    });

    if (!outline || !artifact) {
      return null;
    }

    const outlineNodeId = metadataString(path.metadata, "outlineNodeId");
    const node = outlineNodeId ? findOutlineNodeById(outline.nodes, outlineNodeId) : null;

    if (!node) {
      return null;
    }

    return {
      contentType: "text/markdown",
      text: renderDocumentSectionMarkdown(artifact, node),
    };
  }

  if (isTextLikeMimeType(asset.mimeType)) {
    const body = await objectStorage.getObject(asset.objectKey);

    if (body) {
      return {
        contentType: asset.mimeType,
        text: new TextDecoder().decode(body),
      };
    }
  }

  const artifact = await parseArtifacts.getByDocumentVersion({
    documentAssetId: asset.id,
    version: path.version ?? asset.version,
  });

  if (artifact) {
    return {
      contentType: "text/markdown",
      text: renderParseArtifactMarkdown(artifact),
    };
  }

  const body = await objectStorage.getObject(asset.objectKey);

  if (!body) {
    return null;
  }

  return {
    contentType: asset.mimeType,
    text: new TextDecoder().decode(body),
  };
}

function isTextLikeMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/ld+json" ||
    mimeType === "application/markdown" ||
    mimeType === "application/xml" ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml")
  );
}

async function artifactHasSegments({
  artifactSegments,
  input,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly input: KnowledgeFsReadCommandInput;
  readonly path: KnowledgePath;
}): Promise<boolean> {
  const firstPage = await artifactSegments.listByArtifact({
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: 1,
    parseArtifactId: path.targetId,
  });

  return firstPage.items.length > 0;
}

async function catLegacyParseArtifact({
  input,
  parseArtifacts,
  path,
}: {
  readonly input: KnowledgeFsReadCommandInput;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
}): Promise<KnowledgeFsCatResult> {
  const artifact = await parseArtifacts.getById({ id: path.targetId });

  if (!artifact) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  const startIndex = input.cursor ? decodeArtifactSegmentCursor(input.cursor) + 1 : 0;
  const limit = input.limit ?? 100;
  const page = artifact.elements.slice(startIndex, startIndex + limit + 1);
  const items = page.slice(0, limit);
  const text = items.map((element) => element.text ?? "").join("");
  const nextCursor = page.length > limit ? String(startIndex + items.length - 1) : undefined;

  return {
    contentType: legacyArtifactContentType(artifact),
    ...(nextCursor ? { nextCursor } : {}),
    path: path.virtualPath,
    text,
    truncated: Boolean(nextCursor),
  };
}

function legacyArtifactContentType(artifact: ParseArtifact): string {
  switch (artifact.contentType) {
    case "structured":
      return "application/json";
    case "mixed":
      return "text/markdown";
    default:
      return "text/plain";
  }
}

async function readArtifactSegmentText({
  objectStorage,
  segment,
}: {
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly segment: Awaited<
    ReturnType<ArtifactSegmentRepository["listByArtifact"]>
  >["items"][number];
}): Promise<string> {
  if (segment.inlineText !== undefined) {
    return segment.inlineText;
  }

  if (!segment.objectKey) {
    return "";
  }

  const body = await objectStorage.getObject(segment.objectKey);

  if (!body) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  return new TextDecoder().decode(body);
}

function decodeArtifactSegmentCursor(cursor: string): number {
  const decoded = Number(cursor);

  if (!Number.isInteger(decoded) || decoded < 0) {
    throw new KnowledgeFsValidationError("Invalid artifact segment cursor");
  }

  return decoded;
}

function isHtmlKnowledgeFsTablePath(path: KnowledgePath): boolean {
  return path.virtualPath.endsWith(".html") || path.metadata.format === "html";
}

function renderKnowledgeFsTableHtml(node: KnowledgeNode): string {
  const table = parseKnowledgeFsTablePayload(node.text);

  if (!table) {
    return `<pre>${escapeHtml(node.text)}</pre>`;
  }

  const caption = typeof node.metadata.caption === "string" ? node.metadata.caption : undefined;
  const captionHtml = caption ? `<caption>${escapeHtml(caption)}</caption>` : "";
  const headerHtml = table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const rowsHtml = table.rows
    .map(
      (row) =>
        `<tr>${table.columns.map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`).join("")}</tr>`,
    )
    .join("");

  return `<table>${captionHtml}<thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function parseKnowledgeFsTablePayload(text: string): {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
} | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    const rows = parsed.filter(isPlainObject);
    const columns = uniqueStrings(rows.flatMap((row) => Object.keys(row)));

    return columns.length > 0 ? { columns, rows } : null;
  }

  if (!isPlainObject(parsed) || !Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
    return null;
  }

  const columns = parsed.columns.filter((column): column is string => typeof column === "string");
  const rows = parsed.rows.map((row) => normalizeKnowledgeFsTableRow(row, columns));

  return columns.length > 0 ? { columns, rows } : null;
}

function normalizeKnowledgeFsTableRow(
  row: unknown,
  columns: readonly string[],
): Record<string, unknown> {
  if (Array.isArray(row)) {
    return Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ""]));
  }

  if (isPlainObject(row)) {
    return cloneJsonObject(row);
  }

  return Object.fromEntries(columns.map((column) => [column, ""]));
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderKnowledgeFsImageMarkdown(node: KnowledgeNode): string {
  const caption = typeof node.metadata.caption === "string" ? node.metadata.caption : undefined;
  const ocrText =
    typeof node.metadata.ocrText === "string" && node.metadata.ocrText.trim()
      ? node.metadata.ocrText
      : node.text;
  const sourceLocation = node.sourceLocation;
  const lines = [
    "# Figure",
    "",
    ...(caption ? [`Caption: ${caption}`, ""] : []),
    "## OCR Text",
    "",
    ocrText,
    "",
    "## Source Location",
    "",
    ...(sourceLocation.pageNumber ? [`- Page: ${sourceLocation.pageNumber}`] : []),
    `- Section: ${sourceLocation.sectionPath.join(" > ") || "Document"}`,
    `- Offsets: ${sourceLocation.startOffset ?? node.startOffset}-${sourceLocation.endOffset ?? node.endOffset}`,
    "",
    "## Metadata",
    "",
    `\`\`\`json\n${JSON.stringify(cloneJsonObject(node.metadata))}\n\`\`\``,
  ];

  return lines.join("\n");
}

function renderParseArtifactMarkdown(artifact: ParseArtifact): string {
  return artifact.elements
    .map(renderParseElementMarkdown)
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function renderDocumentSectionMarkdown(artifact: ParseArtifact, node: DocumentOutlineNode): string {
  const elements = artifact.elements.filter((element) =>
    elementSectionStartsWith(element.sectionPath, node.sectionPath),
  );
  const rendered = elements
    .map(renderParseElementMarkdown)
    .filter((text) => text.length > 0)
    .join("\n\n");

  if (rendered.trim()) {
    return rendered;
  }

  return [
    `# ${node.title}`,
    "",
    node.summary ? node.summary : "No parsed content was available for this section.",
  ].join("\n");
}

function findOutlineNodeById(
  nodes: readonly DocumentOutlineNode[],
  id: string,
): DocumentOutlineNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }

    const child = findOutlineNodeById(node.children, id);

    if (child) {
      return child;
    }
  }

  return null;
}

function elementSectionStartsWith(
  elementSectionPath: readonly string[],
  selectedSectionPath: readonly string[],
): boolean {
  if (
    selectedSectionPath.length === 1 &&
    selectedSectionPath[0] === "Document" &&
    elementSectionPath.length === 0
  ) {
    return true;
  }

  return selectedSectionPath.every((segment, index) => elementSectionPath[index] === segment);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];

  return typeof value === "string" ? value : undefined;
}

function isDocumentMultimodalItemDescriptorContentKind(
  value: string | undefined,
): value is
  | "document-multimodal-figure"
  | "document-multimodal-page-thumbnail"
  | "document-multimodal-table" {
  return (
    value === "document-multimodal-figure" ||
    value === "document-multimodal-page-thumbnail" ||
    value === "document-multimodal-table"
  );
}

function documentMultimodalItemDescriptorResourceKind(value: string): string {
  switch (value) {
    case "document-multimodal-figure":
      return "figure";
    case "document-multimodal-page-thumbnail":
      return "page-thumbnail";
    case "document-multimodal-table":
      return "table";
    default:
      return "multimodal-item";
  }
}

function renderParseElementMarkdown(element: ParseElement): string {
  const text = element.text?.trim();

  if (!text) {
    return "";
  }

  if (element.type === "title") {
    return `# ${text}`;
  }

  if (element.type === "heading") {
    return `## ${text}`;
  }

  if (element.type === "code") {
    return `\`\`\`\n${text}\n\`\`\``;
  }

  return text;
}

async function statKnowledgeFsPath({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsReadCommandInput;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsStatResult> {
  const path = await resolveKnowledgeFsPath(paths, input);
  await assertCandidateCanReadPath({
    artifactSegments,
    assets,
    input,
    nodes,
    parseArtifacts,
    path,
  });
  const base = {
    metadata: cloneJsonObject(path.metadata),
    path: path.virtualPath,
    resourceType: path.resourceType,
    targetId: path.targetId,
    ...(path.version === undefined ? {} : { version: path.version }),
  };

  if (path.resourceType !== "document") {
    return base;
  }

  const asset = await assets.get({
    id: path.targetId,
    knowledgeSpaceId: input.knowledgeSpaceId,
  });

  if (!asset || !candidatePermissionAllowsAsset(asset, candidateGrants(input))) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  return {
    ...base,
    contentType: asset.mimeType,
    parserStatus: asset.parserStatus,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
  };
}

async function resolveKnowledgeFsPath(
  paths: KnowledgePathRepository,
  input: KnowledgeFsReadCommandInput,
): Promise<KnowledgePath> {
  const path = await paths.get({
    knowledgeSpaceId: input.knowledgeSpaceId,
    virtualPath: normalizeKnowledgeFsPath(input.path),
  });

  if (!path) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }

  return path;
}

function candidateGrants(input: {
  readonly candidatePermissionScope?: readonly string[] | undefined;
}): readonly string[] {
  return input.candidatePermissionScope ?? [];
}

function assertCandidatePermissionScopeAllowsPath(
  path: Pick<KnowledgePath, "metadata">,
  input: { readonly candidatePermissionScope?: readonly string[] | undefined },
): void {
  if (!candidatePermissionScopeAllows(path.metadata.permissionScope, candidateGrants(input))) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }
}

async function filterCandidateReadablePaths(input: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: readonly KnowledgePath[];
}): Promise<KnowledgePath[]> {
  const decisions = await Promise.all(
    input.paths.map((path) => isCandidateReadablePath({ ...input, path })),
  );
  return input.paths.filter((_path, index) => decisions[index] === true);
}

async function listCandidateReadablePathPage(input: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly candidateInput: {
    readonly candidatePermissionScope?: readonly string[] | undefined;
    readonly limit: number;
  };
  readonly cursor?: KnowledgePathCursor | undefined;
  readonly listPage: (input: {
    readonly cursor?: KnowledgePathCursor | undefined;
    readonly limit: number;
  }) => Promise<{ readonly items: KnowledgePath[]; readonly nextCursor?: KnowledgePathCursor }>;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
}): Promise<{ readonly items: KnowledgePath[]; readonly nextCursor?: KnowledgePathCursor }> {
  const readable: KnowledgePath[] = [];
  let scanCursor = input.cursor;
  let reachedEnd = false;

  for (let scannedPages = 0; scannedPages < KNOWLEDGE_FS_MAX_SCAN_PAGES; scannedPages += 1) {
    const page = await input.listPage({
      ...(scanCursor ? { cursor: scanCursor } : {}),
      limit: input.candidateInput.limit,
    });
    readable.push(
      ...(await filterCandidateReadablePaths({
        artifactSegments: input.artifactSegments,
        assets: input.assets,
        input: input.candidateInput,
        nodes: input.nodes,
        parseArtifacts: input.parseArtifacts,
        paths: page.items,
      })),
    );

    if (readable.length > input.candidateInput.limit) {
      break;
    }
    if (!page.nextCursor) {
      reachedEnd = true;
      break;
    }
    scanCursor = page.nextCursor;
  }

  const items = readable.slice(0, input.candidateInput.limit);
  const lastItem = items.at(-1);
  if (readable.length <= input.candidateInput.limit && !reachedEnd) {
    throw new CandidateVisibilityScanBudgetExceededError();
  }
  return {
    items,
    ...(readable.length > input.candidateInput.limit && lastItem
      ? { nextCursor: knowledgePathCursor(lastItem) }
      : {}),
  };
}

async function isCandidateReadablePath({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
}): Promise<boolean> {
  const grants = candidateGrants(input);
  if (!candidatePermissionScopeAllows(path.metadata.permissionScope, grants)) {
    return false;
  }

  if (
    path.resourceType === "workspace" &&
    path.viewType === "semantic" &&
    path.viewName === KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME
  ) {
    return isCandidateReadableCommunityWorkspace({ assets, input, path });
  }

  if (path.resourceType === "document") {
    const asset = await assets.get({
      id: path.targetId,
      knowledgeSpaceId: path.knowledgeSpaceId,
    });
    return Boolean(asset && candidatePermissionAllowsAsset(asset, grants));
  }
  if (path.resourceType === "node") {
    const node = await nodes.get({
      id: path.targetId,
      knowledgeSpaceId: path.knowledgeSpaceId,
    });
    return Boolean(node && (await isCandidateReadableNodeWithAsset({ assets, input, node })));
  }
  if (path.resourceType === "artifact") {
    return isCandidateReadableArtifact({ artifactSegments, assets, input, parseArtifacts, path });
  }

  return true;
}

async function isCandidateReadableCommunityWorkspace({
  assets,
  input,
  path,
}: {
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly path: KnowledgePath;
}): Promise<boolean> {
  const documentAssetIds = boundedPermissionClosureIds(path.metadata.documentAssetIds);
  if (!documentAssetIds || documentAssetIds.length === 0) {
    return false;
  }

  const referencedAssets = await Promise.all(
    documentAssetIds.map((id) => assets.get({ id, knowledgeSpaceId: path.knowledgeSpaceId })),
  );
  return referencedAssets.every((asset) =>
    asset ? candidatePermissionAllowsAsset(asset, candidateGrants(input)) : false,
  );
}

async function isCandidateReadableNodeWithAsset({
  assets,
  input,
  node,
}: {
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly node: KnowledgeNode;
}): Promise<boolean> {
  if (!candidatePermissionAllowsNode(node, candidateGrants(input))) {
    return false;
  }
  const asset = await assets.get({
    id: node.documentAssetId,
    knowledgeSpaceId: node.knowledgeSpaceId,
  });
  return Boolean(asset && candidatePermissionAllowsAsset(asset, candidateGrants(input)));
}

function boundedPermissionClosureIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > KNOWLEDGE_FS_MAX_PERMISSION_CLOSURE_ITEMS) {
    return null;
  }

  const ids: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      !entry ||
      entry !== entry.trim() ||
      entry.length > 512 ||
      ids.includes(entry)
    ) {
      return null;
    }
    ids.push(entry);
  }
  return ids;
}

async function assertCandidateCanReadPath(input: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: KnowledgePath;
}): Promise<void> {
  if (!(await isCandidateReadablePath(input))) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }
}

async function isCandidateReadableArtifact({
  artifactSegments,
  assets,
  input,
  parseArtifacts,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: Pick<KnowledgePath, "knowledgeSpaceId" | "targetId">;
}): Promise<boolean> {
  const artifact = await parseArtifacts?.getById?.({ id: path.targetId });
  const documentAssetId =
    artifact?.documentAssetId ??
    (
      await artifactSegments.listByArtifact({
        knowledgeSpaceId: path.knowledgeSpaceId,
        limit: 1,
        parseArtifactId: path.targetId,
      })
    ).items[0]?.documentAssetId;
  if (!documentAssetId || typeof assets.get !== "function") {
    return false;
  }
  const asset = await assets.get({
    id: documentAssetId,
    knowledgeSpaceId: path.knowledgeSpaceId,
  });
  return Boolean(asset && candidatePermissionAllowsAsset(asset, candidateGrants(input)));
}

async function assertCandidateCanReadArtifact({
  artifactSegments,
  assets,
  input,
  parseArtifacts,
  path,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: { readonly candidatePermissionScope?: readonly string[] | undefined };
  readonly parseArtifacts: ParseArtifactRepository;
  readonly path: Pick<KnowledgePath, "knowledgeSpaceId" | "targetId">;
}): Promise<void> {
  if (
    !(await isCandidateReadableArtifact({ artifactSegments, assets, input, parseArtifacts, path }))
  ) {
    throw new KnowledgeFsNotFoundError("KnowledgeFS path not found");
  }
}

async function treeKnowledgeFsDirectory({
  artifactSegments,
  assets,
  input,
  nodes,
  parseArtifacts,
  paths,
}: {
  readonly artifactSegments: ArtifactSegmentRepository;
  readonly assets: DocumentAssetRepository;
  readonly input: KnowledgeFsCommandInput;
  readonly nodes: KnowledgeNodeRepository;
  readonly parseArtifacts: ParseArtifactRepository;
  readonly paths: KnowledgePathRepository;
}): Promise<KnowledgeFsTreeResult> {
  const parsedPath = parseKnowledgeFsPhysicalPath(input.path);
  const result = await listCandidateReadablePathPage({
    artifactSegments,
    assets,
    ...(input.cursor ? { cursor: decodeKnowledgePathCursor(input.cursor) } : {}),
    candidateInput: input,
    listPage: ({ cursor, limit }) =>
      paths.listPhysicalDescendants({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit,
        parentPath: parsedPath.path,
        viewName: parsedPath.viewName,
      }),
    nodes,
    parseArtifacts,
  });

  return {
    ...(result.nextCursor ? { nextCursor: encodeKnowledgePathCursor(result.nextCursor) } : {}),
    path: parsedPath.path,
    root: buildKnowledgeFsTree(parsedPath.path, result.items, input.depth ?? 1),
    truncated: Boolean(result.nextCursor),
  };
}

function buildKnowledgeFsEntries(
  parentPath: string,
  paths: readonly KnowledgePath[],
): KnowledgeFsEntry[] {
  const prefix = knowledgePathDescendantPrefix(parentPath);
  const entries = new Map<string, KnowledgeFsEntry>();

  for (const path of paths) {
    const relativePath = path.virtualPath.slice(prefix.length);
    const [name, ...rest] = relativePath.split("/");

    /* v8 ignore next 3 -- descendant queries only return paths below parentPath. */
    if (!name) {
      continue;
    }

    const entryPath = `${prefix}${name}`;

    if (entries.has(entryPath)) {
      continue;
    }

    entries.set(
      entryPath,
      rest.length > 0
        ? {
            kind: "directory",
            metadata: {},
            name,
            path: entryPath,
          }
        : knowledgePathToResourceEntry(path),
    );
  }

  return [...entries.values()];
}

function buildKnowledgeFsSemanticEntries(
  parentPath: string,
  paths: readonly KnowledgePath[],
): KnowledgeFsEntry[] {
  const prefix = knowledgePathDescendantPrefix(parentPath);
  const entries = new Map<string, KnowledgeFsEntry>();

  for (const path of paths) {
    const relativePath = path.virtualPath.slice(prefix.length);
    const [name, ...rest] = relativePath.split("/");

    /* v8 ignore next 3 -- descendant queries only return paths below parentPath. */
    if (!name) {
      continue;
    }

    const entryPath = `${prefix}${name}`;

    if (entries.has(entryPath)) {
      continue;
    }

    entries.set(
      entryPath,
      rest.length > 0
        ? {
            kind: "directory",
            metadata: cloneJsonObject(path.metadata),
            name,
            path: entryPath,
          }
        : knowledgePathToResourceEntry(path),
    );
  }

  return [...entries.values()];
}

function buildKnowledgeFsTree(
  parentPath: string,
  paths: readonly KnowledgePath[],
  depth: number,
): KnowledgeFsTreeNode {
  const normalizedParent = normalizeKnowledgeFsPath(parentPath);
  const root: KnowledgeFsTreeNode = {
    children: [],
    kind: "directory",
    metadata: {},
    name: normalizedParent.split("/").at(-1) ?? normalizedParent,
    path: normalizedParent,
  };
  const prefix = knowledgePathDescendantPrefix(parentPath);
  const directories = new Map<string, KnowledgeFsTreeNode>([[root.path, root]]);

  for (const path of paths) {
    const segments = path.virtualPath.slice(prefix.length).split("/").filter(Boolean);
    const visibleSegments = segments.slice(0, depth);
    let parent = root;
    let currentPath = normalizedParent;

    for (const [index, segment] of visibleSegments.entries()) {
      currentPath = `${currentPath}/${segment}`;
      const isResource = index === segments.length - 1;
      const existing = directories.get(currentPath);

      if (existing) {
        parent = existing;
        continue;
      }

      const node: KnowledgeFsTreeNode = isResource
        ? knowledgePathToResourceEntry(path)
        : {
            children: [],
            kind: "directory",
            metadata: {},
            name: segment,
            path: currentPath,
          };
      parent.children = [...(parent.children ?? []), node];

      if (node.kind === "directory") {
        directories.set(currentPath, node);
        parent = node;
      }
    }
  }

  return root;
}

function knowledgePathToResourceEntry(path: KnowledgePath): KnowledgeFsEntry {
  return {
    kind: "resource",
    metadata: cloneJsonObject(path.metadata),
    name: path.virtualPath.split("/").at(-1) ?? path.virtualPath,
    path: path.virtualPath,
    resourceType: path.resourceType,
    targetId: path.targetId,
    ...(path.version === undefined ? {} : { version: path.version }),
  };
}

function knowledgePathMatchesFind(
  path: KnowledgePath,
  input: KnowledgeFsFindCommandInput,
): boolean {
  if (input.resourceType && path.resourceType !== input.resourceType) {
    return false;
  }

  if (
    input.nameContains &&
    !path.virtualPath
      .split("/")
      .at(-1)
      ?.toLocaleLowerCase()
      .includes(input.nameContains.toLocaleLowerCase())
  ) {
    return false;
  }

  if (input.metadataKey && input.metadataValue) {
    const value = path.metadata[input.metadataKey];

    if (String(value ?? "") !== input.metadataValue) {
      return false;
    }
  }

  return true;
}
