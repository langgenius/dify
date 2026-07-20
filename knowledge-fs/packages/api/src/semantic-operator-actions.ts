import { type KnowledgeNode, type KnowledgePath, KnowledgePathSchema } from "@knowledge/core";

import { uniqueStrings } from "./api-shared-utils";
import {
  candidatePermissionAllowsAsset,
  candidatePermissionAllowsNode,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { buildDocumentKnowledgePath } from "./document-knowledge-paths";
import {
  type EntityExtractionFlow,
  extractedEntitiesFromNodeMetadata,
} from "./entity-extraction-flow";
import {
  type ExtractionQualityControlFlow,
  createExtractionQualityControlFlow,
} from "./extraction-quality-control-flow";
import type { GraphIndexRepository } from "./graph-index-repository";
import {
  type GraphIndexStats,
  type GraphIndexWriter,
  createGraphIndexWriter,
} from "./graph-index-writer";
import { cloneJsonObject } from "./json-utils";
import {
  KNOWLEDGE_FS_BY_TOPIC_ROOT,
  KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
} from "./knowledge-fs-path-utils";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";
import { type KnowledgePathRepository, cloneKnowledgePath } from "./knowledge-path-repository";
import type { RelationExtractionFlow } from "./relation-extraction-flow";
import {
  SemanticCandidateClosureUnavailableError,
  SemanticCandidateVisibilityDeniedError,
} from "./semantic-candidate-authorization";
import {
  type MaterializeSemanticCommunitiesInput,
  type MaterializeSemanticCommunitiesResult,
  type SemanticCommunityMaterializer,
  createSemanticCommunityMaterializer,
} from "./semantic-community-materializer";

export interface SemanticOperatorOptions {
  readonly assets: DocumentAssetRepository;
  readonly entityExtraction?: EntityExtractionFlow | undefined;
  readonly extractionQuality?: ExtractionQualityControlFlow | undefined;
  readonly generatePathId: () => string;
  readonly graph: GraphIndexRepository;
  readonly maxCommunitiesPerRun?: number | undefined;
  readonly maxDocumentsPerRun: number;
  readonly maxNodesPerRun: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly paths: KnowledgePathRepository;
  readonly relationExtraction?: RelationExtractionFlow | undefined;
}

export interface MaterializeTopicViewInput {
  /** Current server-issued grants. Omitted only by trusted internal schedulers. */
  readonly candidateGrants?: readonly string[] | undefined;
  readonly generatedVersion?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit?: number | undefined;
  readonly tenantId: string;
  readonly topicName?: string | undefined;
  readonly topicSlug?: string | undefined;
}

export interface MaterializeTopicViewResult {
  readonly documentCount: number;
  readonly generatedVersion: string;
  readonly knowledgeSpaceId: string;
  readonly pathCount: number;
  readonly paths: readonly KnowledgePath[];
  readonly topicName: string;
  readonly topicSlug: string;
}

export interface ExtractSemanticEntitiesInput {
  /** Current server-issued grants. Omitted only by trusted internal schedulers. */
  readonly candidateGrants?: readonly string[] | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit?: number | undefined;
  readonly tenantId: string;
  readonly traceId?: string | undefined;
}

export interface ExtractSemanticEntitiesResult {
  readonly entitiesExtracted: number;
  readonly extractionMode: "provider";
  readonly graphEntitiesIndexed: number;
  readonly graphRelationsIndexed: number;
  readonly knowledgeSpaceId: string;
  readonly nodesScanned: number;
  readonly nodesUpdated: number;
}

export interface SemanticOperator {
  extractEntities(input: ExtractSemanticEntitiesInput): Promise<ExtractSemanticEntitiesResult>;
  materializeCommunities(
    input: MaterializeSemanticCommunitiesInput,
  ): Promise<MaterializeSemanticCommunitiesResult>;
  materializeTopicView(input: MaterializeTopicViewInput): Promise<MaterializeTopicViewResult>;
}

type NormalizedMaterializeTopicViewInput = MaterializeTopicViewInput & {
  readonly generatedVersion: string;
  readonly limit: number;
  readonly topicName: string;
  readonly topicSlug: string;
};

type NormalizedExtractSemanticEntitiesInput = ExtractSemanticEntitiesInput & {
  readonly limit: number;
};

export function createSemanticOperator({
  assets,
  entityExtraction,
  extractionQuality,
  generatePathId,
  graph,
  maxCommunitiesPerRun = 20,
  maxDocumentsPerRun,
  maxNodesPerRun,
  nodes,
  now = () => new Date().toISOString(),
  paths,
  relationExtraction,
}: SemanticOperatorOptions): SemanticOperator {
  validatePositiveInteger(maxDocumentsPerRun, "Semantic operator maxDocumentsPerRun");
  validatePositiveInteger(maxNodesPerRun, "Semantic operator maxNodesPerRun");

  const graphWriter = createGraphIndexWriter({
    extractionVersion: 1,
    graph,
    maxBatchSize: maxNodesPerRun,
    nodes,
  });
  const communityMaterializer = createSemanticCommunityMaterializer({
    assets,
    graph,
    maxCommunitiesPerRun,
    maxEntitiesPerRun: maxNodesPerRun,
    maxSourceNodesPerRun: maxNodesPerRun,
    nodes,
    now,
    paths,
  });
  const defaultQualityFlow =
    extractionQuality ??
    (entityExtraction
      ? createExtractionQualityControlFlow({
          maxBatchSize: maxNodesPerRun,
          nodes,
          now,
        })
      : undefined);

  return {
    extractEntities: async (input) =>
      extractSemanticEntities({
        assets,
        graph,
        graphWriter,
        input: {
          ...input,
          limit: input.limit ?? maxNodesPerRun,
        },
        maxNodesPerRun,
        nodes,
        now,
        providerFlow: entityExtraction,
        qualityFlow: defaultQualityFlow,
        relationFlow: relationExtraction,
      }),
    materializeCommunities: async (input) =>
      materializeSemanticCommunities({
        communityMaterializer,
        input,
      }),
    materializeTopicView: async (input) =>
      materializeTopicView({
        assets,
        generatePathId,
        input: {
          ...input,
          generatedVersion: input.generatedVersion ?? "operator-topic-view-v1",
          limit: input.limit ?? maxDocumentsPerRun,
          topicName: input.topicName ?? "Uploaded Documents",
          topicSlug: input.topicSlug ?? "uploaded-documents",
        },
        maxDocumentsPerRun,
        now,
        paths,
      }),
  };
}

async function materializeSemanticCommunities({
  communityMaterializer,
  input,
}: {
  readonly communityMaterializer: SemanticCommunityMaterializer;
  readonly input: MaterializeSemanticCommunitiesInput;
}): Promise<MaterializeSemanticCommunitiesResult> {
  return communityMaterializer.materialize(input);
}

async function materializeTopicView({
  assets,
  generatePathId,
  input,
  maxDocumentsPerRun,
  now,
  paths,
}: {
  readonly assets: DocumentAssetRepository;
  readonly generatePathId: () => string;
  readonly input: NormalizedMaterializeTopicViewInput;
  readonly maxDocumentsPerRun: number;
  readonly now: () => string;
  readonly paths: KnowledgePathRepository;
}): Promise<MaterializeTopicViewResult> {
  validatePositiveInteger(input.limit, "Semantic topic materialization limit");
  if (input.limit > maxDocumentsPerRun) {
    throw new Error(
      `Semantic topic materialization limit exceeds maxDocumentsPerRun=${maxDocumentsPerRun}`,
    );
  }

  const documents = await assets.list({
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: input.limit,
  });
  if (input.candidateGrants !== undefined && documents.nextCursor) {
    throw new SemanticCandidateClosureUnavailableError();
  }
  const authorizedDocuments = documents.items.flatMap((asset) => {
    const permissionScope = candidatePermissionScopeSnapshot(asset.metadata.permissionScope);
    if (
      !permissionScope ||
      (input.candidateGrants !== undefined &&
        !candidatePermissionAllowsAsset(asset, input.candidateGrants))
    ) {
      return [];
    }
    return [{ asset, permissionScope }];
  });
  if (
    input.candidateGrants !== undefined &&
    authorizedDocuments.length !== documents.items.length
  ) {
    throw new SemanticCandidateVisibilityDeniedError();
  }
  const generatedAt = now();
  const materializedPaths = authorizedDocuments.map(({ asset, permissionScope }) =>
    KnowledgePathSchema.parse({
      id: generatePathId(),
      knowledgeSpaceId: input.knowledgeSpaceId,
      metadata: {
        filename: asset.filename,
        mimeType: asset.mimeType,
        permissionScope,
        semanticView: {
          buildStatus: "ready",
          generatedAt,
          generatedVersion: input.generatedVersion,
          operatorAction: "topic-materialize",
          staleStatus: "fresh",
        },
        tenantId: input.tenantId,
        topicName: input.topicName,
        topicSlug: input.topicSlug,
      },
      resourceType: "document",
      targetId: asset.id,
      version: asset.version,
      viewName: KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME,
      viewType: "semantic",
      virtualPath: `${KNOWLEDGE_FS_BY_TOPIC_ROOT}/${input.topicSlug}/${asset.id}`,
    }),
  );
  const documentPaths = authorizedDocuments.map(({ asset, permissionScope }) => {
    const path = buildDocumentKnowledgePath({
      asset,
      id: generatePathId(),
      tenantId: input.tenantId,
    });
    return KnowledgePathSchema.parse({
      ...path,
      metadata: { ...path.metadata, permissionScope },
    });
  });
  const upserted = materializedPaths.length
    ? await paths.upsertMany([...documentPaths, ...materializedPaths])
    : [];

  return {
    documentCount: authorizedDocuments.length,
    generatedVersion: input.generatedVersion,
    knowledgeSpaceId: input.knowledgeSpaceId,
    pathCount: materializedPaths.length,
    paths: upserted
      .filter((path) => path.viewName === KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME)
      .map(cloneKnowledgePath),
    topicName: input.topicName,
    topicSlug: input.topicSlug,
  };
}

async function extractSemanticEntities({
  assets,
  graphWriter,
  graph,
  input,
  maxNodesPerRun,
  nodes,
  now,
  providerFlow,
  qualityFlow,
  relationFlow,
}: {
  readonly assets: DocumentAssetRepository;
  readonly graph: GraphIndexRepository;
  readonly graphWriter: GraphIndexWriter;
  readonly input: NormalizedExtractSemanticEntitiesInput;
  readonly maxNodesPerRun: number;
  readonly nodes: KnowledgeNodeRepository;
  readonly now: () => string;
  readonly providerFlow?: EntityExtractionFlow | undefined;
  readonly qualityFlow?: ExtractionQualityControlFlow | undefined;
  readonly relationFlow?: RelationExtractionFlow | undefined;
}): Promise<ExtractSemanticEntitiesResult> {
  validatePositiveInteger(input.limit, "Semantic entity extraction limit");
  if (input.limit > maxNodesPerRun) {
    throw new Error(`Semantic entity extraction limit exceeds maxNodesPerRun=${maxNodesPerRun}`);
  }

  const page = await nodes.listBySpace({
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: input.limit,
  });
  if (input.candidateGrants !== undefined && page.nextCursor) {
    throw new SemanticCandidateClosureUnavailableError();
  }
  const pageItems =
    input.candidateGrants === undefined
      ? page.items
      : await filterAuthorizedSemanticNodes({
          assets,
          candidateGrants: input.candidateGrants,
          nodes: page.items,
        });
  if (input.candidateGrants !== undefined && pageItems.length !== page.items.length) {
    throw new SemanticCandidateVisibilityDeniedError();
  }

  if (pageItems.length === 0) {
    return {
      entitiesExtracted: 0,
      extractionMode: "provider",
      graphEntitiesIndexed: 0,
      graphRelationsIndexed: 0,
      knowledgeSpaceId: input.knowledgeSpaceId,
      nodesScanned: 0,
      nodesUpdated: 0,
    };
  }

  if (!providerFlow) {
    throw new Error("Semantic entity extraction requires an LLM provider");
  }

  // A scoped HTTP caller may add newly extracted, fully visible contributions, but must never
  // prune a shared entity/relation that can also contain hidden source-node associations.
  if (input.candidateGrants === undefined) {
    await pruneExistingSemanticGraph({
      graph,
      knowledgeSpaceId: input.knowledgeSpaceId,
      maxSourceNodes: maxNodesPerRun,
    });
  }

  return extractProviderSemanticEntities({
    graphWriter,
    input,
    pageItems,
    providerFlow,
    qualityFlow,
    relationFlow,
  });
}

async function pruneExistingSemanticGraph({
  graph,
  knowledgeSpaceId,
  maxSourceNodes,
}: {
  readonly graph: GraphIndexRepository;
  readonly knowledgeSpaceId: string;
  readonly maxSourceNodes: number;
}): Promise<void> {
  const existing = await graph.listEntities({
    knowledgeSpaceId,
    limit: maxSourceNodes,
  });
  const existingSourceNodeIds = uniqueStrings(
    existing.items.flatMap((entity) => entity.sourceNodeIds),
  );

  if (existingSourceNodeIds.length === 0) {
    return;
  }

  await graph.pruneSourceNodes({
    knowledgeSpaceId,
    maxSourceNodes,
    sourceNodeIds: existingSourceNodeIds.slice(0, maxSourceNodes),
  });
}

async function filterAuthorizedSemanticNodes({
  assets,
  candidateGrants,
  nodes,
}: {
  readonly assets: DocumentAssetRepository;
  readonly candidateGrants: readonly string[];
  readonly nodes: readonly KnowledgeNode[];
}): Promise<KnowledgeNode[]> {
  const assetById = new Map(
    (
      await Promise.all(
        uniqueStrings(nodes.map((node) => node.documentAssetId)).map((id) =>
          assets.get({ id, knowledgeSpaceId: nodes[0]?.knowledgeSpaceId ?? "" }),
        ),
      )
    ).flatMap((asset) => (asset ? [[asset.id, asset] as const] : [])),
  );

  return nodes.filter((node) => {
    const asset = assetById.get(node.documentAssetId);
    return Boolean(
      asset &&
        candidatePermissionAllowsNode(node, candidateGrants) &&
        candidatePermissionAllowsAsset(asset, candidateGrants),
    );
  });
}

async function extractProviderSemanticEntities({
  graphWriter,
  input,
  pageItems,
  providerFlow,
  qualityFlow,
  relationFlow,
}: {
  readonly graphWriter: GraphIndexWriter;
  readonly input: NormalizedExtractSemanticEntitiesInput;
  readonly pageItems: readonly KnowledgeNode[];
  readonly providerFlow: EntityExtractionFlow;
  readonly qualityFlow?: ExtractionQualityControlFlow | undefined;
  readonly relationFlow?: RelationExtractionFlow | undefined;
}): Promise<ExtractSemanticEntitiesResult> {
  if (pageItems.length === 0) {
    return {
      entitiesExtracted: 0,
      extractionMode: "provider",
      graphEntitiesIndexed: 0,
      graphRelationsIndexed: 0,
      knowledgeSpaceId: input.knowledgeSpaceId,
      nodesScanned: 0,
      nodesUpdated: 0,
    };
  }

  const nodeIds = pageItems.map((node) => node.id);
  const extracted = await providerFlow.extract({
    knowledgeSpaceId: input.knowledgeSpaceId,
    nodeIds,
    traceId: input.traceId,
  });
  const relationNodes = relationFlow
    ? (
        await relationFlow.extract({
          knowledgeSpaceId: input.knowledgeSpaceId,
          nodeIds: extracted.extractedNodes.map((node) => node.id),
          traceId: input.traceId,
        })
      ).extractedNodes
    : extracted.extractedNodes;
  const nodesForIndex = qualityFlow
    ? (
        await qualityFlow.apply({
          knowledgeSpaceId: input.knowledgeSpaceId,
          nodeIds: relationNodes.map((node) => node.id),
          traceId: input.traceId,
        })
      ).controlledNodes
    : relationNodes;
  const indexed =
    nodesForIndex.length === 0
      ? emptyGraphIndexStats()
      : (
          await graphWriter.index({
            knowledgeSpaceId: input.knowledgeSpaceId,
            nodeIds: nodesForIndex.map((node) => node.id),
            traceId: input.traceId,
          })
        ).stats;

  return {
    entitiesExtracted: nodesForIndex.reduce(
      (sum, node) => sum + extractedEntitiesFromNodeMetadata(node).length,
      0,
    ),
    extractionMode: "provider",
    graphEntitiesIndexed: indexed.entitiesIndexed,
    graphRelationsIndexed: indexed.relationsIndexed,
    knowledgeSpaceId: input.knowledgeSpaceId,
    nodesScanned: pageItems.length,
    nodesUpdated: nodesForIndex.length,
  };
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be at least 1`);
  }
}

function emptyGraphIndexStats(): GraphIndexStats {
  return {
    entitiesIndexed: 0,
    relationsIndexed: 0,
    skippedEntities: 0,
    skippedRelations: 0,
  };
}
