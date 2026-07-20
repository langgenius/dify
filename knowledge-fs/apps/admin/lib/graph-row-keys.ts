import type { AdminGraphEntity, AdminGraphRelation } from "./api-client";

export function adminRowKey(scope: string, id: string, index: number): string {
  return [scope, id, index].join(":");
}

export function graphEntityRowKey(entity: AdminGraphEntity, index: number): string {
  return ["entity", entity.id, entity.depth, entity.canonicalKey, entity.type, index].join(":");
}

export function graphRelationRowKey(relation: AdminGraphRelation, index: number): string {
  return [
    "relation",
    relation.id,
    relation.depth,
    relation.subjectEntityId,
    relation.type,
    relation.objectEntityId,
    index,
  ].join(":");
}
