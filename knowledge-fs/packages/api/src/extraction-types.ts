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

export type RelationExtractionType =
  | "contradicts"
  | "defines"
  | "depends_on"
  | "mentions"
  | "references"
  | "supersedes";

export const RELATION_EXTRACTION_TYPES = new Set<RelationExtractionType>([
  "contradicts",
  "defines",
  "depends_on",
  "mentions",
  "references",
  "supersedes",
]);
