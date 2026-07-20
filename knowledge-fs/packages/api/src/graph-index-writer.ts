import { createHash } from "node:crypto";

import { type KnowledgeNode, PublicationGenerationIdSchema } from "@knowledge/core";

import {
  ENTITY_EXTRACTION_TYPES,
  type EntityExtractionType,
  RELATION_EXTRACTION_TYPES,
  type RelationExtractionType,
} from "./extraction-types";
import {
  type GraphEntity,
  type GraphIndexRepository,
  type GraphRelation,
  cloneGraphEntity,
  cloneGraphRelation,
} from "./graph-index-repository";
import { cloneJsonObject, isPlainObject } from "./json-utils";
import { type KnowledgeNodeRepository, cloneKnowledgeNode } from "./knowledge-node-repository";

export interface GraphIndexWriterOptions {
  readonly extractionVersion: number;
  readonly graph: GraphIndexRepository;
  readonly maxBatchSize: number;
  readonly nodes: KnowledgeNodeRepository;
}

export interface WriteGraphIndexInput {
  readonly knowledgeSpaceId: string;
  readonly nodeIds: readonly string[];
  readonly publicationGenerationId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface GraphIndexStats {
  readonly entitiesIndexed: number;
  readonly relationsIndexed: number;
  readonly skippedEntities: number;
  readonly skippedRelations: number;
}

export interface WriteGraphIndexResult {
  readonly entities: GraphEntity[];
  readonly missingNodeIds: readonly string[];
  readonly relations: GraphRelation[];
  readonly stats: GraphIndexStats;
}

export interface GraphIndexWriter {
  index(input: WriteGraphIndexInput): Promise<WriteGraphIndexResult>;
}

export function createGraphIndexWriter({
  extractionVersion,
  graph,
  maxBatchSize,
  nodes,
}: GraphIndexWriterOptions): GraphIndexWriter {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Graph index maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(extractionVersion) || extractionVersion < 1) {
    throw new Error("Graph index extractionVersion must be at least 1");
  }

  return {
    index: async ({
      knowledgeSpaceId,
      nodeIds,
      publicationGenerationId: requestedPublicationGenerationId,
      traceId,
    }) => {
      validateGraphIndexInput({
        knowledgeSpaceId,
        maxBatchSize,
        nodeIds,
        publicationGenerationId: requestedPublicationGenerationId,
      });
      const publicationGenerationId =
        requestedPublicationGenerationId === undefined
          ? undefined
          : PublicationGenerationIdSchema.parse(requestedPublicationGenerationId);
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
      const timestamp = new Date().toISOString();
      const entityAccumulator = new Map<string, GraphEntityAccumulator>();
      let skippedEntities = 0;
      let skippedRelations = 0;
      const rawRelations: RawGraphRelationCandidate[] = [];

      for (const node of orderedNodes) {
        for (const entity of graphEntitiesFromNodeMetadata(node)) {
          if (!entity.quality?.graphEligible) {
            skippedEntities += 1;
            continue;
          }

          const canonicalName = graphEntityCanonicalName(entity);
          const canonicalKey = graphEntityCanonicalKey(entity.type, canonicalName);
          const existing = entityAccumulator.get(canonicalKey);
          const next: GraphEntityAccumulator = existing ?? {
            aliases: [],
            canonicalKey,
            confidence: entity.confidence,
            metadata: {},
            name: canonicalName,
            permissionScope: [],
            sourceNodeIds: [],
            type: entity.type,
          };

          entityAccumulator.set(canonicalKey, {
            ...next,
            aliases: uniqueStrings([...next.aliases, entity.text]),
            confidence: Math.max(next.confidence, entity.confidence),
            metadata: {
              ...cloneJsonObject(next.metadata),
              ...(entity.metadata ? cloneJsonObject(entity.metadata) : {}),
              ...(traceId ? { traceId } : {}),
            },
            permissionScope: uniqueStrings([...next.permissionScope, ...node.permissionScope]),
            sourceNodeIds: uniqueStrings([...next.sourceNodeIds, node.id]),
          });
        }

        for (const relation of graphRelationsFromNodeMetadata(node)) {
          if (!relation.quality?.graphEligible) {
            skippedRelations += 1;
            continue;
          }

          rawRelations.push({ node, relation });
        }
      }

      const entityInputs = Array.from(entityAccumulator.values())
        .sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey))
        .map((entity) =>
          cloneGraphEntity({
            aliases: entity.aliases,
            canonicalKey: entity.canonicalKey,
            confidence: entity.confidence,
            createdAt: timestamp,
            extractionVersion,
            id: deterministicChildId(
              knowledgeSpaceId,
              generationScopedSeed(`graph-entity:${entity.canonicalKey}`, publicationGenerationId),
            ),
            knowledgeSpaceId,
            metadata: entity.metadata,
            name: entity.name,
            permissionScope: entity.permissionScope,
            ...(publicationGenerationId ? { publicationGenerationId } : {}),
            sourceNodeIds: entity.sourceNodeIds,
            type: entity.type,
            updatedAt: timestamp,
          }),
        );
      const storedEntities = await graph.upsertEntities(entityInputs);
      // Back-reference: record on each source node the graph entity ids it now maps to, so
      // retrieval can seed graph expansion from a node's matched entities. `updateMetadataMany`
      // replaces metadata, so merge onto the node's current metadata. This runs as the last
      // node-mutating ingest step, so nothing overwrites it afterward.
      const graphEntityIdsByNode = new Map<string, string[]>();

      for (const entity of storedEntities) {
        for (const nodeId of entity.sourceNodeIds) {
          const ids = graphEntityIdsByNode.get(nodeId) ?? [];

          if (!ids.includes(entity.id)) {
            ids.push(entity.id);
          }

          graphEntityIdsByNode.set(nodeId, ids);
        }
      }

      const backReferencePatches = Array.from(graphEntityIdsByNode.entries()).flatMap(
        ([nodeId, graphEntityIds]) => {
          const node = nodesById.get(nodeId);

          return node
            ? [
                {
                  id: nodeId,
                  metadata: {
                    ...cloneJsonObject(node.metadata),
                    graphEntityIds: [...graphEntityIds].sort(),
                  },
                },
              ]
            : [];
        },
      );

      // Candidate graph ids must not leak into the shared KnowledgeNode metadata. Deep retrieval
      // resolves candidate/published graph membership from the publication generation instead.
      if (publicationGenerationId === undefined && backReferencePatches.length > 0) {
        await nodes.updateMetadataMany({ knowledgeSpaceId, patches: backReferencePatches });
      }

      const entitiesByKey = new Map(storedEntities.map((entity) => [entity.canonicalKey, entity]));
      const relationAccumulator = new Map<string, GraphRelationAccumulator>();

      for (const { node, relation } of rawRelations) {
        const subject = graphEntityForMention({
          entitiesByKey,
          mention: relation.subject,
          node,
        });
        const object = graphEntityForMention({
          entitiesByKey,
          mention: relation.object,
          node,
        });

        if (!subject || !object) {
          skippedRelations += 1;
          continue;
        }

        const relationKey = [
          subject.id,
          relation.type,
          object.id,
          extractionVersion.toString(),
        ].join(":");
        const existing = relationAccumulator.get(relationKey);
        const next: GraphRelationAccumulator = existing ?? {
          confidence: relation.confidence,
          metadata: {},
          objectEntityId: object.id,
          permissionScope: [],
          sourceNodeIds: [],
          subjectEntityId: subject.id,
          type: relation.type,
        };

        relationAccumulator.set(relationKey, {
          ...next,
          confidence: Math.max(next.confidence, relation.confidence),
          metadata: {
            ...cloneJsonObject(next.metadata),
            ...(relation.metadata ? cloneJsonObject(relation.metadata) : {}),
            ...(traceId ? { traceId } : {}),
          },
          permissionScope: uniqueStrings([...next.permissionScope, ...node.permissionScope]),
          sourceNodeIds: uniqueStrings([...next.sourceNodeIds, node.id]),
        });
      }

      const relationInputs = Array.from(relationAccumulator.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, relation]) =>
          cloneGraphRelation({
            confidence: relation.confidence,
            createdAt: timestamp,
            extractionVersion,
            id: deterministicChildId(
              knowledgeSpaceId,
              generationScopedSeed(`graph-relation:${key}`, publicationGenerationId),
            ),
            knowledgeSpaceId,
            metadata: relation.metadata,
            objectEntityId: relation.objectEntityId,
            permissionScope: relation.permissionScope,
            ...(publicationGenerationId ? { publicationGenerationId } : {}),
            sourceNodeIds: relation.sourceNodeIds,
            subjectEntityId: relation.subjectEntityId,
            type: relation.type,
            updatedAt: timestamp,
          }),
        );
      const storedRelations = await graph.upsertRelations(relationInputs);

      return {
        entities: storedEntities.map(cloneGraphEntity),
        missingNodeIds,
        relations: storedRelations.map(cloneGraphRelation),
        stats: {
          entitiesIndexed: storedEntities.length,
          relationsIndexed: storedRelations.length,
          skippedEntities,
          skippedRelations,
        },
      };
    },
  };
}

type GraphQualityFlag = {
  readonly graphEligible: boolean;
  readonly reason?: "budget" | "confidence-threshold" | "duplicate" | undefined;
};

interface GraphMetadataEntity {
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly quality?: GraphQualityFlag | undefined;
  readonly text: string;
  readonly type: EntityExtractionType;
}

interface GraphMetadataRelation {
  readonly confidence: number;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly object: string;
  readonly quality?: GraphQualityFlag | undefined;
  readonly subject: string;
  readonly type: RelationExtractionType;
}

interface GraphEntityAccumulator {
  readonly aliases: readonly string[];
  readonly canonicalKey: string;
  readonly confidence: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly permissionScope: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly type: EntityExtractionType;
}

interface GraphRelationAccumulator {
  readonly confidence: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectEntityId: string;
  readonly permissionScope: readonly string[];
  readonly sourceNodeIds: readonly string[];
  readonly subjectEntityId: string;
  readonly type: RelationExtractionType;
}

interface RawGraphRelationCandidate {
  readonly node: KnowledgeNode;
  readonly relation: GraphMetadataRelation;
}

function graphEntitiesFromNodeMetadata(node: KnowledgeNode): GraphMetadataEntity[] {
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
        ...(isGraphQualityFlag(entity.quality)
          ? { quality: cloneGraphQualityFlag(entity.quality) }
          : {}),
        text: entity.text.trim(),
        type: entity.type as EntityExtractionType,
      },
    ];
  });
}

function graphRelationsFromNodeMetadata(node: KnowledgeNode): GraphMetadataRelation[] {
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
        ...(isGraphQualityFlag(relation.quality)
          ? { quality: cloneGraphQualityFlag(relation.quality) }
          : {}),
        object: relation.object.trim(),
        subject: relation.subject.trim(),
        type: relation.type as RelationExtractionType,
      },
    ];
  });
}

function isGraphQualityFlag(value: unknown): value is GraphQualityFlag {
  return (
    isPlainObject(value) &&
    typeof value.graphEligible === "boolean" &&
    (value.reason === undefined ||
      value.reason === "budget" ||
      value.reason === "confidence-threshold" ||
      value.reason === "duplicate")
  );
}

function cloneGraphQualityFlag(value: GraphQualityFlag): GraphQualityFlag {
  return value.reason
    ? { graphEligible: value.graphEligible, reason: value.reason }
    : { graphEligible: value.graphEligible };
}

function graphEntityCanonicalName(entity: GraphMetadataEntity): string {
  const canonicalName = entity.metadata?.canonicalName;

  return typeof canonicalName === "string" && canonicalName.trim()
    ? canonicalName.trim()
    : entity.text.trim();
}

function graphEntityCanonicalKey(type: EntityExtractionType, text: string): string {
  return `${type}:${text.trim().toLocaleLowerCase()}`;
}

function graphEntityForMention({
  entitiesByKey,
  mention,
  node,
}: {
  readonly entitiesByKey: ReadonlyMap<string, GraphEntity>;
  readonly mention: string;
  readonly node: KnowledgeNode;
}): GraphEntity | undefined {
  for (const entity of graphEntitiesFromNodeMetadata(node)) {
    const canonicalName = graphEntityCanonicalName(entity);
    const candidates = [
      graphEntityCanonicalKey(entity.type, canonicalName),
      graphEntityCanonicalKey(entity.type, mention),
    ];

    if (
      entity.text.toLocaleLowerCase() === mention.trim().toLocaleLowerCase() ||
      canonicalName.toLocaleLowerCase() === mention.trim().toLocaleLowerCase()
    ) {
      for (const key of candidates) {
        const graphEntity = entitiesByKey.get(key);

        if (graphEntity) {
          return graphEntity;
        }
      }
    }
  }

  return undefined;
}

function validateGraphIndexInput({
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
    throw new Error("Graph index knowledgeSpaceId is required");
  }

  if (nodeIds.length < 1) {
    throw new Error("Graph index nodeIds must contain at least 1 node id");
  }

  if (nodeIds.length > maxBatchSize) {
    throw new Error(`Graph index nodeIds exceeds maxBatchSize=${maxBatchSize}`);
  }

  if (
    publicationGenerationId !== undefined &&
    !PublicationGenerationIdSchema.safeParse(publicationGenerationId).success
  ) {
    throw new Error("Graph index publicationGenerationId must be a non-zero UUID");
  }

  for (const nodeId of nodeIds) {
    if (!nodeId.trim()) {
      throw new Error("Graph index nodeIds must be non-empty strings");
    }
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function generationScopedSeed(seed: string, publicationGenerationId: string | undefined): string {
  return publicationGenerationId
    ? `publication-generation:${publicationGenerationId}:${seed}`
    : seed;
}

function deterministicChildId(parentId: string, seed: string): string {
  const hex = createHash("sha256").update(`${parentId}:${seed}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
