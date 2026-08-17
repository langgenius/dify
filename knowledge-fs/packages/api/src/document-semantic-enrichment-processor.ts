import { createHash } from "node:crypto";

import {
  type KnowledgeNode,
  type KnowledgeSpaceModelSelection,
  type KnowledgeSpaceRetrievalProfile,
  PublicationGenerationIdSchema,
  stableJson,
} from "@knowledge/core";

import { type ConcurrencyGate, mapWithConcurrency } from "./bounded-concurrency";
import type {
  DocumentSemanticEnrichmentCheckpointScope,
  DocumentSemanticEnrichmentJob,
  DocumentSemanticExtractionCheckpoint,
  DocumentSemanticExtractionCheckpointRepository,
} from "./document-semantic-enrichment-repository";
import {
  createEntityExtractionFlow,
  extractedEntitiesFromNodeMetadata,
} from "./entity-extraction-flow";
import { createExtractionQualityControlFlow } from "./extraction-quality-control-flow";
import type { GraphIndexRepository } from "./graph-index-repository";
import { createGraphIndexWriter } from "./graph-index-writer";
import type { IngestionModelCallOperationalMetrics } from "./ingestion-model-observability";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import {
  type KnowledgeNodeRepository,
  cloneKnowledgeNode,
  createInMemoryKnowledgeNodeRepository,
} from "./knowledge-node-repository";
import {
  type EntityExtractionTextProvider,
  createLlmEntityExtractionProvider,
} from "./llm-entity-extraction-provider";
import {
  type RelationExtractionTextProvider,
  createLlmRelationExtractionProvider,
} from "./llm-relation-extraction-provider";
import { hasValidLlmSemanticJointExtraction } from "./llm-semantic-chunker";
import { createRelationExtractionFlow } from "./relation-extraction-flow";

export type DocumentSemanticEnrichmentTextProvider = EntityExtractionTextProvider &
  RelationExtractionTextProvider;

export interface DocumentSemanticEnrichmentProcessorResult {
  readonly entitiesExtracted: number;
  readonly graphEntityIds: readonly string[];
  readonly graphEntitiesIndexed: number;
  readonly graphRelationIds: readonly string[];
  readonly graphRelationsIndexed: number;
  readonly nodesScanned: number;
  readonly semanticProviderCalls: number;
  readonly semanticProviderCallsMaximum: number;
}

export interface DocumentSemanticEnrichmentProcessor {
  process(job: DocumentSemanticEnrichmentJob): Promise<DocumentSemanticEnrichmentProcessorResult>;
}

export interface JointSemanticGraphMaterializer {
  materialize(input: {
    readonly createdAt: string;
    readonly knowledgeSpaceId: string;
    readonly parseArtifactId: string;
    readonly publicationGenerationId: string;
    readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
  }): Promise<DocumentSemanticEnrichmentProcessorResult>;
}

export interface JointSemanticGraphMaterializerOptions {
  readonly graph: GraphIndexRepository;
  readonly maxEntitiesPerNode: number;
  readonly maxNodesPerArtifact: number;
  readonly maxRelationsPerNode: number;
  readonly nodeListPageSize?: number | undefined;
  readonly nodes: Pick<KnowledgeNodeRepository, "listByArtifact">;
  readonly now?: (() => string) | undefined;
}

export interface DocumentSemanticEnrichmentProcessorOptions {
  readonly checkpoints: DocumentSemanticExtractionCheckpointRepository;
  readonly graph: GraphIndexRepository;
  readonly maxConcurrentBatches: number;
  readonly maxEntitiesPerNode: number;
  readonly maxNodesPerArtifact: number;
  readonly maxOutputTokens: number;
  readonly maxRelationsPerNode: number;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly modelCallMetrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly nodeListPageSize?: number | undefined;
  readonly nodes: Pick<KnowledgeNodeRepository, "listByArtifact">;
  readonly now?: (() => string) | undefined;
  readonly providerBatchSize: number;
  readonly providerFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => DocumentSemanticEnrichmentTextProvider;
}

const entityPromptVersion = "entity-extraction-v1";
const relationPromptVersion = "relation-extraction-v1";
const defaultNodeListPageSize = 100;

/**
 * Builds graph rows from checkpoint-decorated node copies. Published KnowledgeNode rows remain
 * immutable; each successful provider batch is durable before the next retry boundary.
 */
export function createDocumentSemanticEnrichmentProcessor({
  checkpoints,
  graph,
  maxConcurrentBatches,
  maxEntitiesPerNode,
  maxNodesPerArtifact,
  maxOutputTokens,
  maxRelationsPerNode,
  modelCallMetrics,
  modelRequestGate,
  nodeListPageSize = Math.min(maxNodesPerArtifact, defaultNodeListPageSize),
  nodes,
  now = () => new Date().toISOString(),
  providerBatchSize,
  providerFactory,
}: DocumentSemanticEnrichmentProcessorOptions): DocumentSemanticEnrichmentProcessor {
  for (const [name, value] of Object.entries({
    maxConcurrentBatches,
    maxEntitiesPerNode,
    maxNodesPerArtifact,
    maxOutputTokens,
    maxRelationsPerNode,
    nodeListPageSize,
    providerBatchSize,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Document semantic enrichment ${name} must be at least 1`);
    }
  }

  return {
    process: async (job) => {
      const generationId = PublicationGenerationIdSchema.parse(job.publicationGenerationId);
      const originalNodes = await listArtifactNodesWithinBound({
        countExceededMessage: `Document semantic enrichment node count exceeds maxNodesPerArtifact=${maxNodesPerArtifact}`,
        knowledgeSpaceId: job.knowledgeSpaceId,
        maxNodes: maxNodesPerArtifact,
        nodes,
        pageSize: nodeListPageSize,
        parseArtifactId: job.parseArtifactId,
        publicationGenerationId: generationId,
      });
      if (originalNodes.length === 0) {
        return {
          entitiesExtracted: 0,
          graphEntityIds: [],
          graphEntitiesIndexed: 0,
          graphRelationIds: [],
          graphRelationsIndexed: 0,
          nodesScanned: 0,
          semanticProviderCalls: 0,
          semanticProviderCallsMaximum: 0,
        };
      }

      const selection = job.retrievalProfile.reasoningModel;
      if (!selection) {
        throw new Error("Document semantic enrichment requires a frozen reasoning model");
      }
      const jointSemanticNodes = originalNodes.filter(hasValidLlmSemanticJointExtraction);
      if (jointSemanticNodes.length > 0) {
        if (jointSemanticNodes.length !== originalNodes.length) {
          throw new Error(
            "Document semantic enrichment refuses a mixed joint/legacy node generation",
          );
        }
        if (
          jointSemanticNodes.some(
            (node) => stableJson(jointSemanticModelSelection(node)) !== stableJson(selection),
          )
        ) {
          throw new Error(
            "Document semantic enrichment joint metadata does not match the frozen reasoning model",
          );
        }
        return indexPreparedSemanticNodes({
          graph,
          job,
          maxEntitiesPerNode,
          maxNodesPerArtifact,
          maxRelationsPerNode,
          nodes: jointSemanticNodes,
          now,
          semanticProviderCalls: 0,
          semanticProviderCallsMaximum: 0,
        });
      }
      let semanticProviderCalls = 0;
      const resolvedProvider = providerFactory(selection);
      const provider: DocumentSemanticEnrichmentTextProvider = {
        ...(resolvedProvider.kind ? { kind: resolvedProvider.kind } : {}),
        generate: async (input) => {
          semanticProviderCalls += 1;
          return resolvedProvider.generate(input);
        },
      };
      const entityProvider = createLlmEntityExtractionProvider({
        maxOutputTokens,
        ...(modelRequestGate ? { modelRequestGate } : {}),
        ...(modelCallMetrics ? { metrics: modelCallMetrics } : {}),
        provider,
      });
      const relationProvider = createLlmRelationExtractionProvider({
        maxOutputTokens,
        ...(modelRequestGate ? { modelRequestGate } : {}),
        ...(modelCallMetrics ? { metrics: modelCallMetrics } : {}),
        provider,
      });
      const scope: DocumentSemanticEnrichmentCheckpointScope = {
        documentAssetId: job.documentAssetId,
        documentVersion: job.documentVersion,
        knowledgeSpaceId: job.knowledgeSpaceId,
        publicationGenerationId: generationId,
        tenantId: job.tenantId,
      };
      const entityCheckpoints = await completeEntityCheckpoints({
        checkpoints,
        maxConcurrentBatches,
        maxEntitiesPerNode,
        nodes: originalNodes,
        now,
        provider: entityProvider,
        providerBatchSize,
        scope,
        selection,
        tenantId: job.tenantId,
      });
      const entityNodes = applyStageCheckpoints(originalNodes, entityCheckpoints);
      const relationCheckpoints = await completeRelationCheckpoints({
        checkpoints,
        maxConcurrentBatches,
        maxRelationsPerNode,
        nodes: entityNodes,
        now,
        provider: relationProvider,
        providerBatchSize,
        scope,
        selection,
        tenantId: job.tenantId,
      });
      const relationNodes = applyStageCheckpoints(entityNodes, relationCheckpoints);
      const eligibleRelationNodes = entityNodes.filter(
        (node) => extractedEntitiesFromNodeMetadata(node).length >= 2,
      ).length;
      return indexPreparedSemanticNodes({
        graph,
        job,
        maxEntitiesPerNode,
        maxNodesPerArtifact,
        maxRelationsPerNode,
        nodes: relationNodes,
        now,
        semanticProviderCalls,
        semanticProviderCallsMaximum:
          Math.ceil(originalNodes.length / providerBatchSize) +
          Math.ceil(eligibleRelationNodes / providerBatchSize),
      });
    },
  };
}

/** Materializes only the joint facts already frozen by semantic chunking; it never calls an LLM. */
export function createJointSemanticGraphMaterializer({
  graph,
  maxEntitiesPerNode,
  maxNodesPerArtifact,
  maxRelationsPerNode,
  nodeListPageSize = Math.min(maxNodesPerArtifact, defaultNodeListPageSize),
  nodes,
  now = () => new Date().toISOString(),
}: JointSemanticGraphMaterializerOptions): JointSemanticGraphMaterializer {
  for (const [name, value] of Object.entries({
    maxEntitiesPerNode,
    maxNodesPerArtifact,
    maxRelationsPerNode,
    nodeListPageSize,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Joint semantic Graph ${name} must be at least 1`);
    }
  }
  return {
    materialize: async (input) => {
      const generationId = PublicationGenerationIdSchema.parse(input.publicationGenerationId);
      const prepared = await listArtifactNodesWithinBound({
        countExceededMessage: `Joint semantic Graph node count exceeds maxNodesPerArtifact=${maxNodesPerArtifact}`,
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxNodes: maxNodesPerArtifact,
        nodes,
        pageSize: nodeListPageSize,
        parseArtifactId: input.parseArtifactId,
        publicationGenerationId: generationId,
      });
      if (prepared.length === 0) {
        return {
          entitiesExtracted: 0,
          graphEntityIds: [],
          graphEntitiesIndexed: 0,
          graphRelationIds: [],
          graphRelationsIndexed: 0,
          nodesScanned: 0,
          semanticProviderCalls: 0,
          semanticProviderCallsMaximum: 0,
        };
      }
      if (prepared.some((node) => !hasValidLlmSemanticJointExtraction(node))) {
        throw new Error("Joint semantic Graph refuses a legacy or invalid node generation");
      }
      const selection = input.retrievalProfile.reasoningModel;
      if (
        prepared.some(
          (node) => stableJson(jointSemanticModelSelection(node)) !== stableJson(selection),
        )
      ) {
        throw new Error("Joint semantic Graph metadata does not match the frozen reasoning model");
      }
      return indexPreparedSemanticNodes({
        graph,
        job: {
          createdAt: input.createdAt,
          knowledgeSpaceId: input.knowledgeSpaceId,
          publicationGenerationId: generationId,
        },
        maxEntitiesPerNode,
        maxNodesPerArtifact,
        maxRelationsPerNode,
        nodes: prepared,
        now,
        semanticProviderCalls: 0,
        semanticProviderCallsMaximum: 0,
      });
    },
  };
}

async function listArtifactNodesWithinBound({
  countExceededMessage,
  knowledgeSpaceId,
  maxNodes,
  nodes,
  pageSize,
  parseArtifactId,
  publicationGenerationId,
}: {
  readonly countExceededMessage: string;
  readonly knowledgeSpaceId: string;
  readonly maxNodes: number;
  readonly nodes: Pick<KnowledgeNodeRepository, "listByArtifact">;
  readonly pageSize: number;
  readonly parseArtifactId: string;
  readonly publicationGenerationId: string;
}): Promise<KnowledgeNode[]> {
  const collected: KnowledgeNode[] = [];
  let cursor: Awaited<ReturnType<KnowledgeNodeRepository["listByArtifact"]>>["nextCursor"];

  do {
    const page = await nodes.listByArtifact({
      ...(cursor ? { cursor } : {}),
      knowledgeSpaceId,
      limit: Math.min(pageSize, maxNodes - collected.length),
      parseArtifactId,
      publicationGenerationId,
    });
    collected.push(...page.items.map(cloneKnowledgeNode));
    cursor = page.nextCursor;
    if (collected.length > maxNodes || (cursor && collected.length >= maxNodes)) {
      throw new Error(countExceededMessage);
    }
  } while (cursor);

  return collected;
}

function jointSemanticModelSelection(node: KnowledgeNode): unknown {
  const semantic = node.metadata.semanticChunking;
  return isPlainObject(semantic) ? semantic.modelSelection : undefined;
}

async function indexPreparedSemanticNodes({
  graph,
  job,
  maxEntitiesPerNode,
  maxNodesPerArtifact,
  maxRelationsPerNode,
  nodes,
  now,
  semanticProviderCalls,
  semanticProviderCallsMaximum,
}: {
  readonly graph: GraphIndexRepository;
  readonly job: Pick<
    DocumentSemanticEnrichmentJob,
    "createdAt" | "knowledgeSpaceId" | "publicationGenerationId"
  >;
  readonly maxEntitiesPerNode: number;
  readonly maxNodesPerArtifact: number;
  readonly maxRelationsPerNode: number;
  readonly nodes: readonly KnowledgeNode[];
  readonly now: () => string;
  readonly semanticProviderCalls: number;
  readonly semanticProviderCallsMaximum: number;
}): Promise<DocumentSemanticEnrichmentProcessorResult> {
  const generationId = PublicationGenerationIdSchema.parse(job.publicationGenerationId);
  const qualityRepository = await temporaryNodeRepository(nodes);
  const controlled = await createExtractionQualityControlFlow({
    maxBatchSize: maxNodesPerArtifact,
    maxEligibleEntitiesPerNode: maxEntitiesPerNode,
    maxEligibleRelationsPerNode: maxRelationsPerNode,
    nodes: qualityRepository,
    now,
  }).apply({
    knowledgeSpaceId: job.knowledgeSpaceId,
    nodeIds: nodes.map((node) => node.id),
    publicationGenerationId: generationId,
  });
  if (controlled.missingNodeIds.length > 0) {
    throw new Error("Document semantic enrichment quality stage lost immutable nodes");
  }
  const indexed = await createGraphIndexWriter({
    extractionVersion: 1,
    graph,
    maxBatchSize: maxNodesPerArtifact,
    nodes: qualityRepository,
    now: () => job.createdAt,
  }).indexNodes({
    knowledgeSpaceId: job.knowledgeSpaceId,
    nodes: controlled.controlledNodes,
    publicationGenerationId: generationId,
  });
  if (indexed.missingNodeIds.length > 0) {
    throw new Error("Document semantic enrichment graph stage lost immutable nodes");
  }
  return {
    entitiesExtracted: controlled.controlledNodes.reduce(
      (sum, node) => sum + extractedEntitiesFromNodeMetadata(node).length,
      0,
    ),
    graphEntityIds: indexed.entities.map((entity) => entity.id),
    graphEntitiesIndexed: indexed.stats.entitiesIndexed,
    graphRelationIds: indexed.relations.map((relation) => relation.id),
    graphRelationsIndexed: indexed.stats.relationsIndexed,
    nodesScanned: nodes.length,
    semanticProviderCalls,
    semanticProviderCallsMaximum,
  };
}

async function completeEntityCheckpoints(input: {
  readonly checkpoints: DocumentSemanticExtractionCheckpointRepository;
  readonly maxConcurrentBatches: number;
  readonly maxEntitiesPerNode: number;
  readonly nodes: readonly KnowledgeNode[];
  readonly now: () => string;
  readonly provider: ReturnType<typeof createLlmEntityExtractionProvider>;
  readonly providerBatchSize: number;
  readonly scope: DocumentSemanticEnrichmentCheckpointScope;
  readonly selection: KnowledgeSpaceModelSelection;
  readonly tenantId: string;
}): Promise<DocumentSemanticExtractionCheckpoint[]> {
  const keys = input.nodes.map((node) => ({
    inputFingerprint: semanticFingerprint({
      maxEntitiesPerNode: input.maxEntitiesPerNode,
      node: semanticNodeFingerprintMaterial(node),
      promptVersion: entityPromptVersion,
      selection: input.selection,
      stage: "entity",
    }),
    nodeId: node.id,
    stage: "entity" as const,
  }));
  const existing = await input.checkpoints.getMany({ keys, scope: input.scope });
  const byKey = new Map(existing.map((checkpoint) => [checkpointIdentity(checkpoint), checkpoint]));
  const missing = input.nodes.filter((_, index) => !byKey.has(checkpointIdentity(keys[index])));
  const batches = chunk(missing, input.providerBatchSize);
  const completed = await mapWithConcurrency(batches, input.maxConcurrentBatches, async (batch) => {
    const repository = await temporaryNodeRepository(batch);
    const extracted = await createEntityExtractionFlow({
      maxBatchSize: batch.length,
      maxConcurrency: 1,
      maxEntitiesPerNode: input.maxEntitiesPerNode,
      model: input.selection.model,
      nodes: repository,
      now: input.now,
      promptVersion: entityPromptVersion,
      provider: input.provider,
      providerBatchSize: batch.length,
    }).extract({
      knowledgeSpaceId: input.scope.knowledgeSpaceId,
      nodeIds: batch.map((node) => node.id),
      publicationGenerationId: input.scope.publicationGenerationId,
      tenantId: input.tenantId,
    });
    const checkpoints = extracted.extractedNodes.map((node) => ({
      inputFingerprint: keys.find((key) => key.nodeId === node.id)?.inputFingerprint ?? "",
      nodeId: node.id,
      result: stageMetadata(node, "entity"),
      stage: "entity" as const,
    }));
    return input.checkpoints.putMany({ checkpoints, scope: input.scope });
  });
  for (const checkpoint of completed.flat()) {
    byKey.set(checkpointIdentity(checkpoint), checkpoint);
  }
  return keys.map((key) => requiredStageCheckpoint(byKey.get(checkpointIdentity(key))));
}

async function completeRelationCheckpoints(input: {
  readonly checkpoints: DocumentSemanticExtractionCheckpointRepository;
  readonly maxConcurrentBatches: number;
  readonly maxRelationsPerNode: number;
  readonly nodes: readonly KnowledgeNode[];
  readonly now: () => string;
  readonly provider: ReturnType<typeof createLlmRelationExtractionProvider>;
  readonly providerBatchSize: number;
  readonly scope: DocumentSemanticEnrichmentCheckpointScope;
  readonly selection: KnowledgeSpaceModelSelection;
  readonly tenantId: string;
}): Promise<DocumentSemanticExtractionCheckpoint[]> {
  const keys = input.nodes.map((node) => ({
    inputFingerprint: semanticFingerprint({
      entities: extractedEntitiesFromNodeMetadata(node),
      maxRelationsPerNode: input.maxRelationsPerNode,
      node: semanticNodeFingerprintMaterial(node),
      promptVersion: relationPromptVersion,
      selection: input.selection,
      stage: "relation",
    }),
    nodeId: node.id,
    stage: "relation" as const,
  }));
  const existing = await input.checkpoints.getMany({ keys, scope: input.scope });
  const byKey = new Map(existing.map((checkpoint) => [checkpointIdentity(checkpoint), checkpoint]));
  const ineligible = input.nodes.filter(
    (node, index) =>
      extractedEntitiesFromNodeMetadata(node).length < 2 &&
      !byKey.has(checkpointIdentity(keys[index])),
  );
  if (ineligible.length > 0) {
    const persisted = await input.checkpoints.putMany({
      checkpoints: ineligible.map((node) => ({
        inputFingerprint: keys.find((key) => key.nodeId === node.id)?.inputFingerprint ?? "",
        nodeId: node.id,
        result: { extractedRelations: [] },
        stage: "relation" as const,
      })),
      scope: input.scope,
    });
    for (const checkpoint of persisted) byKey.set(checkpointIdentity(checkpoint), checkpoint);
  }
  const eligibleMissing = input.nodes.filter(
    (node, index) =>
      extractedEntitiesFromNodeMetadata(node).length >= 2 &&
      !byKey.has(checkpointIdentity(keys[index])),
  );
  const batches = chunk(eligibleMissing, input.providerBatchSize);
  const completed = await mapWithConcurrency(batches, input.maxConcurrentBatches, async (batch) => {
    const repository = await temporaryNodeRepository(batch);
    const extracted = await createRelationExtractionFlow({
      maxBatchSize: batch.length,
      maxConcurrency: 1,
      maxRelationsPerNode: input.maxRelationsPerNode,
      model: input.selection.model,
      nodes: repository,
      now: input.now,
      promptVersion: relationPromptVersion,
      provider: input.provider,
      providerBatchSize: batch.length,
    }).extract({
      knowledgeSpaceId: input.scope.knowledgeSpaceId,
      nodeIds: batch.map((node) => node.id),
      publicationGenerationId: input.scope.publicationGenerationId,
      tenantId: input.tenantId,
    });
    const checkpoints = extracted.extractedNodes.map((node) => ({
      inputFingerprint: keys.find((key) => key.nodeId === node.id)?.inputFingerprint ?? "",
      nodeId: node.id,
      result: stageMetadata(node, "relation"),
      stage: "relation" as const,
    }));
    return input.checkpoints.putMany({ checkpoints, scope: input.scope });
  });
  for (const checkpoint of completed.flat()) {
    byKey.set(checkpointIdentity(checkpoint), checkpoint);
  }
  return keys.map((key) => requiredStageCheckpoint(byKey.get(checkpointIdentity(key))));
}

async function temporaryNodeRepository(
  nodes: readonly KnowledgeNode[],
): Promise<KnowledgeNodeRepository> {
  const repository = createInMemoryKnowledgeNodeRepository({
    maxBatchSize: Math.max(1, nodes.length),
    maxListLimit: Math.max(1, nodes.length),
    maxNodes: Math.max(1, nodes.length),
  });
  if (nodes.length > 0) await repository.createMany(nodes.map(cloneKnowledgeNode));
  return repository;
}

function applyStageCheckpoints(
  nodes: readonly KnowledgeNode[],
  checkpoints: readonly DocumentSemanticExtractionCheckpoint[],
): KnowledgeNode[] {
  const byNode = new Map(checkpoints.map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  return nodes.map((node) => {
    const checkpoint = requiredStageCheckpoint(byNode.get(node.id));
    return cloneKnowledgeNode({
      ...node,
      metadata: { ...cloneJsonObject(node.metadata), ...cloneJsonObject(checkpoint.result) },
    });
  });
}

function stageMetadata(
  node: KnowledgeNode,
  stage: "entity" | "relation",
): Readonly<Record<string, unknown>> {
  return stage === "entity"
    ? {
        entityExtraction: structuredClone(node.metadata.entityExtraction ?? {}),
        extractedEntities: structuredClone(node.metadata.extractedEntities ?? []),
      }
    : {
        extractedRelations: structuredClone(node.metadata.extractedRelations ?? []),
        relationExtraction: structuredClone(node.metadata.relationExtraction ?? {}),
      };
}

function semanticNodeFingerprintMaterial(node: KnowledgeNode): Readonly<Record<string, unknown>> {
  return {
    artifactHash: node.artifactHash,
    endOffset: node.endOffset,
    id: node.id,
    kind: node.kind,
    startOffset: node.startOffset,
    text: node.text,
  };
}

function semanticFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function checkpointIdentity(
  checkpoint:
    | DocumentSemanticExtractionCheckpoint
    | { readonly inputFingerprint: string; readonly nodeId: string; readonly stage: string }
    | undefined,
): string {
  if (!checkpoint) return "";
  return `${checkpoint.nodeId}\u001f${checkpoint.stage}\u001f${checkpoint.inputFingerprint}`;
}

function requiredStageCheckpoint(
  checkpoint: DocumentSemanticExtractionCheckpoint | undefined,
): DocumentSemanticExtractionCheckpoint {
  if (!checkpoint) throw new Error("Document semantic enrichment checkpoint is incomplete");
  return checkpoint;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
