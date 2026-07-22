import { type KnowledgeNode, PublicationGenerationIdSchema } from "@knowledge/core";

import { type ExtractedEntity, extractedEntitiesFromNodeMetadata } from "./entity-extraction-flow";
import { cloneJsonObject } from "./json-utils";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";
import {
  type ExtractedRelation,
  extractedRelationsFromNodeMetadata,
} from "./relation-extraction-flow";

export type ExtractionQualityIneligibleReason = "budget" | "confidence-threshold" | "duplicate";

export interface ExtractionQualityControlFlowOptions {
  readonly maxBatchSize: number;
  readonly maxEligibleEntitiesPerNode?: number | undefined;
  readonly maxEligibleRelationsPerNode?: number | undefined;
  readonly minEntityConfidence?: number | undefined;
  readonly minRelationConfidence?: number | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly now?: () => string;
}

export interface ApplyExtractionQualityControlsInput {
  readonly knowledgeSpaceId: string;
  readonly nodeIds: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface ExtractionQualityControlStats {
  readonly eligibleEntities: number;
  readonly eligibleRelations: number;
  readonly ineligibleEntities: number;
  readonly ineligibleRelations: number;
}

export interface ExtractionQualityControlResult {
  readonly controlledNodes: KnowledgeNode[];
  readonly missingNodeIds: readonly string[];
  readonly stats: ExtractionQualityControlStats;
}

export interface ExtractionQualityControlFlow {
  apply(input: ApplyExtractionQualityControlsInput): Promise<ExtractionQualityControlResult>;
}

export function createExtractionQualityControlFlow({
  maxBatchSize,
  maxEligibleEntitiesPerNode = 100,
  maxEligibleRelationsPerNode = 100,
  minEntityConfidence = 0.6,
  minRelationConfidence = 0.6,
  nodes,
  now = () => new Date().toISOString(),
}: ExtractionQualityControlFlowOptions): ExtractionQualityControlFlow {
  validateExtractionQualityControlOptions({
    maxBatchSize,
    maxEligibleEntitiesPerNode,
    maxEligibleRelationsPerNode,
    minEntityConfidence,
    minRelationConfidence,
  });

  return {
    apply: async ({ knowledgeSpaceId, nodeIds, publicationGenerationId, traceId }) => {
      validateExtractionQualityInput({
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
          controlledNodes: [],
          missingNodeIds,
          stats: emptyExtractionQualityStats(),
        };
      }

      const controlled = orderedNodes.map((node) => {
        const entities = applyEntityQualityControls({
          entities: extractedEntitiesFromNodeMetadata(node),
          maxEligibleEntitiesPerNode,
          minEntityConfidence,
        });
        const relations = applyRelationQualityControls({
          maxEligibleRelationsPerNode,
          minRelationConfidence,
          relations: extractedRelationsFromNodeMetadata(node),
        });
        const stats = extractionQualityStats(entities, relations);

        return {
          id: node.id,
          metadata: {
            ...cloneJsonObject(node.metadata),
            extractedEntities: entities,
            extractedRelations: relations,
            extractionQuality: {
              ...stats,
              appliedAt: now(),
              minEntityConfidence,
              minRelationConfidence,
              ...(traceId ? { traceId } : {}),
            },
          },
          stats,
        };
      });
      const controlledNodes = await nodes.updateMetadataMany({
        knowledgeSpaceId,
        patches: controlled.map(({ id, metadata }) => ({ id, metadata })),
        ...(publicationGenerationId ? { publicationGenerationId } : {}),
      });

      return {
        controlledNodes: controlledNodes.map(cloneKnowledgeNode),
        missingNodeIds,
        stats: controlled.reduce(
          (acc, item) => ({
            eligibleEntities: acc.eligibleEntities + item.stats.eligibleEntities,
            eligibleRelations: acc.eligibleRelations + item.stats.eligibleRelations,
            ineligibleEntities: acc.ineligibleEntities + item.stats.ineligibleEntities,
            ineligibleRelations: acc.ineligibleRelations + item.stats.ineligibleRelations,
          }),
          emptyExtractionQualityStats(),
        ),
      };
    },
  };
}

function validateExtractionQualityControlOptions({
  maxBatchSize,
  maxEligibleEntitiesPerNode,
  maxEligibleRelationsPerNode,
  minEntityConfidence,
  minRelationConfidence,
}: {
  readonly maxBatchSize: number;
  readonly maxEligibleEntitiesPerNode: number;
  readonly maxEligibleRelationsPerNode: number;
  readonly minEntityConfidence: number;
  readonly minRelationConfidence: number;
}) {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Extraction quality maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxEligibleEntitiesPerNode) || maxEligibleEntitiesPerNode < 1) {
    throw new Error("Extraction quality maxEligibleEntitiesPerNode must be at least 1");
  }

  if (!Number.isInteger(maxEligibleRelationsPerNode) || maxEligibleRelationsPerNode < 1) {
    throw new Error("Extraction quality maxEligibleRelationsPerNode must be at least 1");
  }

  if (!Number.isFinite(minEntityConfidence) || minEntityConfidence < 0 || minEntityConfidence > 1) {
    throw new Error("Extraction quality minEntityConfidence must be between 0 and 1");
  }

  if (
    !Number.isFinite(minRelationConfidence) ||
    minRelationConfidence < 0 ||
    minRelationConfidence > 1
  ) {
    throw new Error("Extraction quality minRelationConfidence must be between 0 and 1");
  }
}

function validateExtractionQualityInput({
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
    throw new Error("Extraction quality knowledgeSpaceId is required");
  }

  if (nodeIds.length < 1) {
    throw new Error("Extraction quality nodeIds must contain at least 1 node id");
  }

  if (nodeIds.length > maxBatchSize) {
    throw new Error(`Extraction quality nodeIds exceeds maxBatchSize=${maxBatchSize}`);
  }

  if (publicationGenerationId !== undefined) {
    PublicationGenerationIdSchema.parse(publicationGenerationId);
  }

  for (const nodeId of nodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Extraction quality nodeIds must be non-empty strings");
    }
  }
}

type QualityControlledEntity = ExtractedEntity & {
  readonly quality: {
    readonly graphEligible: boolean;
    readonly reason?: ExtractionQualityIneligibleReason | undefined;
  };
};

type QualityControlledRelation = ExtractedRelation & {
  readonly quality: {
    readonly graphEligible: boolean;
    readonly reason?: ExtractionQualityIneligibleReason | undefined;
  };
};

function applyEntityQualityControls({
  entities,
  maxEligibleEntitiesPerNode,
  minEntityConfidence,
}: {
  readonly entities: readonly ExtractedEntity[];
  readonly maxEligibleEntitiesPerNode: number;
  readonly minEntityConfidence: number;
}): QualityControlledEntity[] {
  const seen = new Set<string>();
  let eligibleCount = 0;

  return entities.map((entity) => {
    const normalizedText = entity.text.trim();
    const key = `${entity.type}:${normalizedText.toLocaleLowerCase()}`;
    const reason =
      entity.confidence < minEntityConfidence
        ? "confidence-threshold"
        : seen.has(key)
          ? "duplicate"
          : eligibleCount >= maxEligibleEntitiesPerNode
            ? "budget"
            : undefined;

    seen.add(key);

    if (!reason) {
      eligibleCount += 1;
    }

    return {
      confidence: entity.confidence,
      ...(entity.metadata ? { metadata: cloneJsonObject(entity.metadata) } : {}),
      quality: reason ? { graphEligible: false, reason } : { graphEligible: true },
      text: normalizedText,
      type: entity.type,
    };
  });
}

function applyRelationQualityControls({
  maxEligibleRelationsPerNode,
  minRelationConfidence,
  relations,
}: {
  readonly maxEligibleRelationsPerNode: number;
  readonly minRelationConfidence: number;
  readonly relations: readonly ExtractedRelation[];
}): QualityControlledRelation[] {
  const seen = new Set<string>();
  let eligibleCount = 0;

  return relations.map((relation) => {
    const subject = relation.subject.trim();
    const object = relation.object.trim();
    const key = `${relation.type}:${subject.toLocaleLowerCase()}:${object.toLocaleLowerCase()}`;
    const reason =
      relation.confidence < minRelationConfidence
        ? "confidence-threshold"
        : seen.has(key)
          ? "duplicate"
          : eligibleCount >= maxEligibleRelationsPerNode
            ? "budget"
            : undefined;

    seen.add(key);

    if (!reason) {
      eligibleCount += 1;
    }

    return {
      confidence: relation.confidence,
      ...(relation.metadata ? { metadata: cloneJsonObject(relation.metadata) } : {}),
      object,
      quality: reason ? { graphEligible: false, reason } : { graphEligible: true },
      subject,
      type: relation.type,
    };
  });
}

function extractionQualityStats(
  entities: readonly QualityControlledEntity[],
  relations: readonly QualityControlledRelation[],
): ExtractionQualityControlStats {
  return {
    eligibleEntities: entities.filter((entity) => entity.quality.graphEligible).length,
    eligibleRelations: relations.filter((relation) => relation.quality.graphEligible).length,
    ineligibleEntities: entities.filter((entity) => !entity.quality.graphEligible).length,
    ineligibleRelations: relations.filter((relation) => !relation.quality.graphEligible).length,
  };
}

function emptyExtractionQualityStats(): ExtractionQualityControlStats {
  return {
    eligibleEntities: 0,
    eligibleRelations: 0,
    ineligibleEntities: 0,
    ineligibleRelations: 0,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
