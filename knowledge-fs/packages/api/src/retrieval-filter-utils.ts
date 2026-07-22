import type { KnowledgeNode } from "@knowledge/core";

import type { RetrievalMetadataFilters } from "./retrieval-candidates";

export function normalizeRetrievalMetadataFilters(
  filters: RetrievalMetadataFilters | undefined,
): RetrievalMetadataFilters {
  if (filters === undefined) {
    return {};
  }

  return {
    ...(filters.createdAfter === undefined
      ? {}
      : { createdAfter: normalizeIsoDateFilter("createdAfter", filters.createdAfter) }),
    ...(filters.createdBefore === undefined
      ? {}
      : { createdBefore: normalizeIsoDateFilter("createdBefore", filters.createdBefore) }),
    documentTypes: normalizeStringFilterValues("documentTypes", filters.documentTypes),
    entities: normalizeStringFilterValues("entities", filters.entities),
    freshnessStatuses: normalizeStringFilterValues("freshnessStatuses", filters.freshnessStatuses),
    languages: normalizeStringFilterValues("languages", filters.languages),
    nodeIds: normalizeStringFilterValues("nodeIds", filters.nodeIds),
    nodeKinds: normalizeStringFilterValues(
      "nodeKinds",
      filters.nodeKinds,
    ) as KnowledgeNode["kind"][],
    sourceIds: normalizeStringFilterValues("sourceIds", filters.sourceIds),
    tags: normalizeStringFilterValues("tags", filters.tags),
  };
}

function normalizeIsoDateFilter(name: string, value: string): string {
  const normalized = value.trim();

  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Retrieval metadata filter ${name} must be a valid date string`);
  }

  return normalized;
}

function normalizeStringFilterValues(
  name: string,
  values: readonly string[] | undefined,
): string[] | undefined {
  if (values === undefined) {
    return undefined;
  }

  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) {
    throw new Error(`Retrieval metadata filter ${name} entries must be non-empty strings`);
  }

  return [...new Set(normalized)];
}
