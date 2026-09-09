import { GRAPH_RELATION_TYPES, type GraphRelationType } from "./graph-relation-catalog";

export type EntityExtractionType =
  | "date"
  | "metric"
  | "organization"
  | "person"
  | "policy"
  | "product"
  | "term";

export const ENTITY_EXTRACTION_TYPES = new Set<EntityExtractionType>([
  "date",
  "metric",
  "organization",
  "person",
  "policy",
  "product",
  "term",
]);

export type RelationExtractionType = GraphRelationType;

export const RELATION_EXTRACTION_TYPES = new Set<RelationExtractionType>(GRAPH_RELATION_TYPES);
