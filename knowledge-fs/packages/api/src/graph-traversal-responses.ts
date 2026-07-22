import { z } from "@hono/zod-openapi";

import type {
  GraphTraversalEntity,
  GraphTraversalRelation,
  GraphTraversalResult,
} from "./graph-index-repository";
import { cloneJsonObject } from "./json-utils";

export const GraphEntityResponseSchema = z.object({
  aliases: z.array(z.string()),
  canonicalKey: z.string(),
  confidence: z.number(),
  createdAt: z.string(),
  depth: z.number().int().nonnegative(),
  extractionVersion: z.number().int().positive(),
  id: z.string(),
  knowledgeSpaceId: z.string(),
  metadata: z.record(z.unknown()),
  name: z.string(),
  permissionScope: z.array(z.string()),
  sourceNodeIds: z.array(z.string()),
  type: z.enum(["date", "metric", "organization", "person", "policy", "product", "term"]),
  updatedAt: z.string(),
});

export const GraphRelationResponseSchema = z.object({
  confidence: z.number(),
  createdAt: z.string(),
  depth: z.number().int().positive(),
  extractionVersion: z.number().int().positive(),
  id: z.string(),
  knowledgeSpaceId: z.string(),
  metadata: z.record(z.unknown()),
  objectEntityId: z.string(),
  permissionScope: z.array(z.string()),
  sourceNodeIds: z.array(z.string()),
  subjectEntityId: z.string(),
  type: z.enum(["contradicts", "defines", "depends_on", "mentions", "references", "supersedes"]),
  updatedAt: z.string(),
});

export const GraphTraversalResponseSchema = z.object({
  entities: z.array(GraphEntityResponseSchema),
  metrics: z.object({
    depthReached: z.number().int().nonnegative(),
    elapsedMs: z.number().nonnegative(),
    exploredRelations: z.number().int().nonnegative(),
    fanout: z.number().int().positive(),
    maxDepth: z.number().int().positive(),
    maxNodes: z.number().int().positive(),
    timedOut: z.boolean(),
  }),
  relations: z.array(GraphRelationResponseSchema),
  truncated: z.boolean(),
});

export function graphTraversalResponse(
  result: GraphTraversalResult,
): z.infer<typeof GraphTraversalResponseSchema> {
  return {
    entities: result.entities.map((entity) => graphTraversalEntityResponse(entity)),
    metrics: { ...result.metrics },
    relations: result.relations.map((relation) => graphTraversalRelationResponse(relation)),
    truncated: result.truncated,
  };
}

function graphTraversalEntityResponse(
  entity: GraphTraversalEntity,
): z.infer<typeof GraphEntityResponseSchema> {
  return {
    aliases: [...entity.aliases],
    canonicalKey: entity.canonicalKey,
    confidence: entity.confidence,
    createdAt: entity.createdAt,
    depth: entity.depth,
    extractionVersion: entity.extractionVersion,
    id: entity.id,
    knowledgeSpaceId: entity.knowledgeSpaceId,
    metadata: cloneJsonObject(entity.metadata),
    name: entity.name,
    permissionScope: [...entity.permissionScope],
    sourceNodeIds: [...entity.sourceNodeIds],
    type: entity.type,
    updatedAt: entity.updatedAt,
  };
}

function graphTraversalRelationResponse(
  relation: GraphTraversalRelation,
): z.infer<typeof GraphRelationResponseSchema> {
  return {
    confidence: relation.confidence,
    createdAt: relation.createdAt,
    depth: relation.depth,
    extractionVersion: relation.extractionVersion,
    id: relation.id,
    knowledgeSpaceId: relation.knowledgeSpaceId,
    metadata: cloneJsonObject(relation.metadata),
    objectEntityId: relation.objectEntityId,
    permissionScope: [...relation.permissionScope],
    sourceNodeIds: [...relation.sourceNodeIds],
    subjectEntityId: relation.subjectEntityId,
    type: relation.type,
    updatedAt: relation.updatedAt,
  };
}
