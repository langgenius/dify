import { type KnowledgeNode, PublicationGenerationIdSchema } from "@knowledge/core";

import { type ExtractedEntity, extractedEntitiesFromNodeMetadata } from "./entity-extraction-flow";
import { RELATION_EXTRACTION_TYPES, type RelationExtractionType } from "./extraction-types";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";

export interface ExtractedRelation {
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly object: string;
  readonly subject: string;
  readonly type: RelationExtractionType;
}

export interface RelationExtractionProviderInput {
  readonly entities: readonly ExtractedEntity[];
  readonly maxRelations: number;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly prompt: string;
  readonly promptVersion: string;
  readonly tenantId?: string | undefined;
}

export interface RelationExtractionProviderResult {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly relations: readonly ExtractedRelation[];
}

export interface RelationExtractionProvider {
  extract(input: RelationExtractionProviderInput): Promise<RelationExtractionProviderResult>;
}

export interface RelationExtractionFlowOptions {
  readonly maxBatchSize: number;
  readonly maxRelationsPerNode?: number | undefined;
  readonly model: string;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
  readonly promptVersion?: string | undefined;
  readonly provider: RelationExtractionProvider;
}

export interface ExtractKnowledgeNodeRelationsInput {
  readonly knowledgeSpaceId: string;
  readonly nodeIds: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface RelationExtractionResult {
  readonly extractedNodes: KnowledgeNode[];
  readonly missingNodeIds: readonly string[];
}

export interface RelationExtractionFlow {
  extract(input: ExtractKnowledgeNodeRelationsInput): Promise<RelationExtractionResult>;
}

export function createRelationExtractionFlow({
  maxBatchSize,
  maxRelationsPerNode = 100,
  model,
  nodes,
  now = () => new Date().toISOString(),
  promptVersion = "relation-extraction-v1",
  provider,
}: RelationExtractionFlowOptions): RelationExtractionFlow {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Relation extraction maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxRelationsPerNode) || maxRelationsPerNode < 1) {
    throw new Error("Relation extraction maxRelationsPerNode must be at least 1");
  }

  if (!model.trim()) {
    throw new Error("Relation extraction model is required");
  }

  if (!promptVersion.trim()) {
    throw new Error("Relation extraction promptVersion is required");
  }

  return {
    extract: async ({ knowledgeSpaceId, nodeIds, publicationGenerationId, tenantId, traceId }) => {
      validateRelationExtractionInput({
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
          const entities = extractedEntitiesFromNodeMetadata(node);
          const result = await provider.extract({
            entities,
            maxRelations: maxRelationsPerNode,
            model,
            node: cloneKnowledgeNode(node),
            prompt: relationExtractionPrompt(node, entities),
            promptVersion,
            ...(tenantId ? { tenantId } : {}),
          });
          const relations = validateExtractedRelations(result.relations, maxRelationsPerNode);

          return {
            id: node.id,
            metadata: relationExtractionMetadata({
              metadata: result.metadata,
              model,
              node,
              now,
              promptVersion,
              relations,
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

function validateRelationExtractionInput({
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
    throw new Error("Relation extraction knowledgeSpaceId is required");
  }

  if (nodeIds.length < 1) {
    throw new Error("Relation extraction nodeIds must contain at least 1 node id");
  }

  if (nodeIds.length > maxBatchSize) {
    throw new Error(`Relation extraction nodeIds exceeds maxBatchSize=${maxBatchSize}`);
  }

  if (publicationGenerationId !== undefined) {
    PublicationGenerationIdSchema.parse(publicationGenerationId);
  }

  for (const nodeId of nodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Relation extraction nodeIds must be non-empty strings");
    }
  }
}

function validateExtractedRelations(
  relations: readonly ExtractedRelation[],
  maxRelationsPerNode: number,
): ExtractedRelation[] {
  if (relations.length > maxRelationsPerNode) {
    throw new Error(
      `Relation extraction provider returned ${relations.length} relations over maxRelationsPerNode=${maxRelationsPerNode}`,
    );
  }

  return relations.map((relation) => {
    if (!RELATION_EXTRACTION_TYPES.has(relation.type)) {
      throw new Error("Relation extraction relation type is unsupported");
    }

    if (!relation.subject.trim()) {
      throw new Error("Relation extraction relation subject is required");
    }

    if (!relation.object.trim()) {
      throw new Error("Relation extraction relation object is required");
    }

    if (
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    ) {
      throw new Error("Relation extraction relation confidence must be between 0 and 1");
    }

    return {
      confidence: relation.confidence,
      ...(relation.metadata ? { metadata: cloneJsonObject(relation.metadata) } : {}),
      object: relation.object.trim(),
      subject: relation.subject.trim(),
      type: relation.type,
    };
  });
}

function relationExtractionMetadata({
  metadata,
  model,
  node,
  now,
  promptVersion,
  relations,
  traceId,
}: {
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly model: string;
  readonly node: KnowledgeNode;
  readonly now: () => string;
  readonly promptVersion: string;
  readonly relations: readonly ExtractedRelation[];
  readonly traceId?: string | undefined;
}): Record<string, unknown> {
  return {
    ...cloneJsonObject(node.metadata),
    extractedRelations: relations.map((relation) => ({
      confidence: relation.confidence,
      ...(relation.metadata ? { metadata: cloneJsonObject(relation.metadata) } : {}),
      object: relation.object,
      subject: relation.subject,
      type: relation.type,
    })),
    relationExtraction: {
      ...cloneJsonObject(metadata ?? {}),
      extractedAt: now(),
      model,
      promptVersion,
      relationCount: relations.length,
      ...(traceId ? { traceId } : {}),
    },
  };
}

export function extractedRelationsFromNodeMetadata(node: KnowledgeNode): ExtractedRelation[] {
  const relations = node.metadata.extractedRelations;

  if (!Array.isArray(relations)) {
    return [];
  }

  return relations.flatMap((relation) => {
    if (!isPlainObject(relation)) {
      return [];
    }

    if (
      typeof relation.subject !== "string" ||
      !relation.subject.trim() ||
      typeof relation.object !== "string" ||
      !relation.object.trim() ||
      typeof relation.type !== "string" ||
      !RELATION_EXTRACTION_TYPES.has(relation.type as RelationExtractionType) ||
      typeof relation.confidence !== "number" ||
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    ) {
      return [];
    }

    return [
      {
        confidence: relation.confidence,
        ...(isPlainObject(relation.metadata)
          ? { metadata: cloneJsonObject(relation.metadata) }
          : {}),
        object: relation.object.trim(),
        subject: relation.subject.trim(),
        type: relation.type as RelationExtractionType,
      },
    ];
  });
}

function relationExtractionPrompt(
  node: KnowledgeNode,
  entities: readonly ExtractedEntity[],
): string {
  const sectionPath = node.sourceLocation.sectionPath.join(" > ") || "Unknown section";
  const entityList =
    entities.length === 0
      ? "No pre-extracted entities."
      : entities.map((entity) => `${entity.type}:${entity.text}`).join(", ");

  return [
    "Extract typed relations: mentions, defines, references, depends_on, supersedes, and contradicts.",
    "Use the existing entity context when possible and return confidence scores.",
    `Kind: ${node.kind}`,
    `Section: ${sectionPath}`,
    `Entities: ${entityList}`,
    `Text: ${node.text}`,
  ].join("\n");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
