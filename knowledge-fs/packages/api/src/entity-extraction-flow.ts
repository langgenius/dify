import { type KnowledgeNode, PublicationGenerationIdSchema } from "@knowledge/core";

import { ENTITY_EXTRACTION_TYPES, type EntityExtractionType } from "./extraction-types";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";

export interface ExtractedEntity {
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly text: string;
  readonly type: EntityExtractionType;
}

export interface EntityExtractionProviderInput {
  readonly maxEntities: number;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly prompt: string;
  readonly promptVersion: string;
  readonly tenantId?: string | undefined;
}

export interface EntityExtractionProviderResult {
  readonly entities: readonly ExtractedEntity[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface EntityExtractionProvider {
  extract(input: EntityExtractionProviderInput): Promise<EntityExtractionProviderResult>;
}

export interface EntityExtractionFlowOptions {
  readonly maxBatchSize: number;
  readonly maxEntitiesPerNode?: number | undefined;
  readonly model: string;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly promptVersion?: string | undefined;
  readonly provider: EntityExtractionProvider;
}

export interface ExtractKnowledgeNodeEntitiesInput {
  readonly knowledgeSpaceId: string;
  readonly nodeIds: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface EntityExtractionResult {
  readonly extractedNodes: KnowledgeNode[];
  readonly missingNodeIds: readonly string[];
}

export interface EntityExtractionFlow {
  extract(input: ExtractKnowledgeNodeEntitiesInput): Promise<EntityExtractionResult>;
}

export function createEntityExtractionFlow({
  maxBatchSize,
  maxEntitiesPerNode = 100,
  model,
  nodes,
  now = () => new Date().toISOString(),
  promptVersion = "entity-extraction-v1",
  provider,
}: EntityExtractionFlowOptions): EntityExtractionFlow {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Entity extraction maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxEntitiesPerNode) || maxEntitiesPerNode < 1) {
    throw new Error("Entity extraction maxEntitiesPerNode must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Entity extraction model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Entity extraction promptVersion is required");
  }

  return {
    extract: async ({ knowledgeSpaceId, nodeIds, publicationGenerationId, tenantId, traceId }) => {
      validateEntityExtractionInput({
        knowledgeSpaceId,
        maxBatchSize,
        nodeIds,
        publicationGenerationId,
      });
      const uniqueNodeIds = uniqueStrings(nodeIds);
      const loadedNodes = await nodes.getMany({
        ids: uniqueNodeIds,
        knowledgeSpaceId,
        ...(publicationGenerationId ? { publicationGenerationId } : {}),
      });
      const nodesById = new Map(loadedNodes.map((node) => [node.id, node]));
      const orderedNodes = uniqueNodeIds.flatMap((id) => {
        const node = nodesById.get(id);

        return node ? [cloneKnowledgeNode(node)] : [];
      });
      const missingNodeIds = uniqueNodeIds.filter((id) => !nodesById.has(id));

      if (orderedNodes.length === 0) {
        return {
          extractedNodes: [],
          missingNodeIds,
        };
      }

      const generated = await Promise.all(
        orderedNodes.map(async (node) => {
          const result = await provider.extract({
            maxEntities: maxEntitiesPerNode,
            model,
            node: cloneKnowledgeNode(node),
            prompt: entityExtractionPrompt(node),
            promptVersion,
            ...(tenantId ? { tenantId } : {}),
          });
          const entities = validateExtractedEntities(result.entities, maxEntitiesPerNode);

          return {
            id: node.id,
            metadata: entityExtractionMetadata({
              entities,
              metadata: result.metadata,
              model,
              node,
              now,
              promptVersion,
              traceId,
            }),
          };
        }),
      );
      const extractedNodes = await nodes.updateMetadataMany({
        knowledgeSpaceId,
        patches: generated,
        ...(publicationGenerationId ? { publicationGenerationId } : {}),
      });

      return {
        extractedNodes: extractedNodes.map(cloneKnowledgeNode),
        missingNodeIds,
      };
    },
  };
}

function validateEntityExtractionInput({
  knowledgeSpaceId,
  maxBatchSize,
  nodeIds,
  publicationGenerationId,
}: {
  readonly knowledgeSpaceId: string;
  readonly maxBatchSize: number;
  readonly nodeIds: readonly string[];
  readonly publicationGenerationId?: string | undefined;
}) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Entity extraction knowledgeSpaceId is required");
  }

  if (nodeIds.length < 1) {
    throw new Error("Entity extraction nodeIds must contain at least 1 node id");
  }

  if (nodeIds.length > maxBatchSize) {
    throw new Error(`Entity extraction nodeIds exceeds maxBatchSize=${maxBatchSize}`);
  }

  if (publicationGenerationId !== undefined) {
    PublicationGenerationIdSchema.parse(publicationGenerationId);
  }

  for (const nodeId of nodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Entity extraction nodeIds must be non-empty strings");
    }
  }
}

function validateExtractedEntities(
  entities: readonly ExtractedEntity[],
  maxEntitiesPerNode: number,
): ExtractedEntity[] {
  if (entities.length > maxEntitiesPerNode) {
    throw new Error(
      `Entity extraction provider returned ${entities.length} entities over maxEntitiesPerNode=${maxEntitiesPerNode}`,
    );
  }

  return entities.map((entity) => {
    if (!ENTITY_EXTRACTION_TYPES.has(entity.type)) {
      throw new Error("Entity extraction entity type is unsupported");
    }

    if (!entity.text.trim()) {
      throw new Error("Entity extraction entity text is required");
    }

    if (!Number.isFinite(entity.confidence) || entity.confidence < 0 || entity.confidence > 1) {
      throw new Error("Entity extraction entity confidence must be between 0 and 1");
    }

    return {
      confidence: entity.confidence,
      ...(entity.metadata ? { metadata: cloneJsonObject(entity.metadata) } : {}),
      text: entity.text.trim(),
      type: entity.type,
    };
  });
}

function entityExtractionMetadata({
  entities,
  metadata,
  model,
  node,
  now,
  promptVersion,
  traceId,
}: {
  readonly entities: readonly ExtractedEntity[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly now: () => string;
  readonly promptVersion: string;
  readonly traceId?: string | undefined;
}): Record<string, unknown> {
  return {
    ...cloneJsonObject(node.metadata),
    entityExtraction: {
      ...cloneJsonObject(metadata ?? {}),
      entityCount: entities.length,
      extractedAt: now(),
      model,
      promptVersion,
      ...(traceId ? { traceId } : {}),
    },
    extractedEntities: entities.map((entity) => ({
      confidence: entity.confidence,
      ...(entity.metadata ? { metadata: cloneJsonObject(entity.metadata) } : {}),
      text: entity.text,
      type: entity.type,
    })),
  };
}

function entityExtractionPrompt(node: KnowledgeNode): string {
  const sectionPath = node.sourceLocation.sectionPath.join(" > ") || "Unknown section";

  return [
    "Extract people, organizations, products, dates, policies, terms, and metrics from this knowledge chunk.",
    "Return only typed entities with confidence scores.",
    `Kind: ${node.kind}`,
    `Section: ${sectionPath}`,
    `Text: ${node.text}`,
  ].join("\n");
}

export function extractedEntitiesFromNodeMetadata(node: KnowledgeNode): ExtractedEntity[] {
  const entities = node.metadata.extractedEntities;

  if (!Array.isArray(entities)) {
    return [];
  }

  return entities.flatMap((entity) => {
    if (!isPlainObject(entity)) {
      return [];
    }

    if (
      typeof entity.text !== "string" ||
      !entity.text.trim() ||
      typeof entity.type !== "string" ||
      !ENTITY_EXTRACTION_TYPES.has(entity.type as EntityExtractionType) ||
      typeof entity.confidence !== "number" ||
      !Number.isFinite(entity.confidence) ||
      entity.confidence < 0 ||
      entity.confidence > 1
    ) {
      return [];
    }

    return [
      {
        confidence: entity.confidence,
        ...(isPlainObject(entity.metadata) ? { metadata: cloneJsonObject(entity.metadata) } : {}),
        text: entity.text.trim(),
        type: entity.type as EntityExtractionType,
      },
    ];
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
