import { type DatabaseRow, type KnowledgeNode, SourceLocationSchema } from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  cloneJsonObject,
  isPlainObject,
  jsonObjectColumn,
  jsonStringArrayColumn,
} from "./json-utils";

export type RetrievalSource = "dense" | "fts" | "pageindex" | "visual";

export interface RetrievalCitation {
  readonly artifactHash: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly endOffset?: number | undefined;
  readonly pageNumber?: number | undefined;
  readonly sectionPath: string[];
  readonly startOffset?: number | undefined;
}

export interface RetrievalCandidate {
  readonly citation: RetrievalCitation;
  readonly metadata: Record<string, unknown>;
  readonly nodeId: string;
  readonly permissionScope: readonly string[];
  readonly projectionId: string;
  readonly score: number;
  readonly source: RetrievalSource;
}

export interface SearchDenseInput {
  /** Restrict dense reads to a model-under-evaluation without exposing its building rows globally. */
  readonly denseProjectionModel?: string | undefined;
  readonly denseProjectionStatuses?: readonly ("building" | "ready")[] | undefined;
  readonly denseProjectionVersion?: number | undefined;
  readonly filters?: RetrievalMetadataFilters | undefined;
  readonly knowledgeSpaceId: string;
  readonly permissionScope?: readonly string[] | undefined;
  /**
   * Immutable published projection-set id captured at the query boundary. Database-backed
   * repositories use this id for an authoritative publication-member join; it is deliberately
   * separate from the legacy metadata fingerprint filters.
   */
  readonly projectionSetPublicationId?: string | undefined;
  readonly projectionSetCandidateFingerprint?: string | undefined;
  readonly projectionSetFingerprint?: string | undefined;
  readonly projectionSetReadMode?: "evaluation" | "preview" | "published" | undefined;
  readonly queryVector: readonly number[];
  readonly tenantId?: string | undefined;
  readonly topK: number;
}

export interface SearchFtsInput {
  readonly filters?: RetrievalMetadataFilters | undefined;
  readonly knowledgeSpaceId: string;
  readonly permissionScope?: readonly string[] | undefined;
  /** See {@link SearchDenseInput.projectionSetPublicationId}. */
  readonly projectionSetPublicationId?: string | undefined;
  readonly projectionSetCandidateFingerprint?: string | undefined;
  readonly projectionSetFingerprint?: string | undefined;
  readonly projectionSetReadMode?: "evaluation" | "preview" | "published" | undefined;
  readonly query: string;
  readonly tenantId?: string | undefined;
  readonly topK: number;
}

export interface RetrievalMetadataFilters {
  readonly createdAfter?: string | undefined;
  readonly createdBefore?: string | undefined;
  readonly documentTypes?: readonly string[] | undefined;
  readonly entities?: readonly string[] | undefined;
  readonly freshnessStatuses?: readonly string[] | undefined;
  readonly languages?: readonly string[] | undefined;
  /** Exact knowledge-node ids, used by published Graph expansion after member-safe traversal. */
  readonly nodeIds?: readonly string[] | undefined;
  readonly nodeKinds?: readonly KnowledgeNode["kind"][] | undefined;
  readonly sourceIds?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface HybridRetrievalRepository {
  /**
   * True only when every search leg enforces `projectionSetPublicationId` against authoritative
   * publication-member storage. This lets the retriever distinguish a database join from an
   * in-memory/test repository that needs an injected membership checker.
   */
  readonly publishedMembershipEnforced?: true;
  searchDense(input: SearchDenseInput): Promise<RetrievalCandidate[]>;
  /** Search the separate visual-asset vector space (visual_vector column). */
  searchVisualDense?(input: SearchDenseInput): Promise<RetrievalCandidate[]>;
  searchFts(input: SearchFtsInput): Promise<RetrievalCandidate[]>;
}

export function filterRetrievalCandidatesByMetadata(
  candidates: readonly RetrievalCandidate[],
  filters: RetrievalMetadataFilters,
): RetrievalCandidate[] {
  if (!hasRetrievalMetadataFilters(filters)) {
    return candidates.map((candidate) => cloneRetrievalCandidate(candidate));
  }

  return candidates
    .filter((candidate) => candidateMatchesRetrievalMetadataFilters(candidate, filters))
    .map((candidate) => cloneRetrievalCandidate(candidate));
}

export function normalizeRetrievalPermissionScope(
  permissionScope: readonly string[] | undefined,
): Set<string> | undefined {
  if (permissionScope === undefined) {
    return undefined;
  }

  const allowed = new Set<string>();
  for (const scope of permissionScope) {
    const normalized = scope.trim();

    if (!normalized) {
      throw new Error("Hybrid retrieval permissionScope entries must be non-empty strings");
    }

    allowed.add(normalized);
  }

  return allowed;
}

export function filterRetrievalCandidatesByPermission(
  candidates: readonly RetrievalCandidate[],
  allowedPermissionScope: ReadonlySet<string> | undefined,
): RetrievalCandidate[] {
  if (allowedPermissionScope === undefined) {
    return candidates.map((candidate) => cloneRetrievalCandidate(candidate));
  }

  return candidates
    .filter((candidate) => canReadRetrievalCandidate(candidate, allowedPermissionScope))
    .map((candidate) => cloneRetrievalCandidate(candidate));
}

export function filterRetrievalCandidatesByProjectionSet(
  candidates: readonly RetrievalCandidate[],
  {
    candidateFingerprint,
    mode = "published",
    publishedFingerprint,
  }: {
    readonly candidateFingerprint?: string | undefined;
    readonly mode?: "evaluation" | "preview" | "published" | undefined;
    readonly publishedFingerprint?: string | undefined;
  },
): RetrievalCandidate[] {
  const allowed = new Set<string>();

  if (publishedFingerprint?.trim()) {
    allowed.add(publishedFingerprint.trim());
  }

  if ((mode === "preview" || mode === "evaluation") && candidateFingerprint?.trim()) {
    allowed.add(candidateFingerprint.trim());
  }

  if (allowed.size === 0) {
    return candidates.map((candidate) => cloneRetrievalCandidate(candidate));
  }

  return candidates
    .filter((candidate) => {
      const fingerprint = metadataString(candidate.metadata, "projectionSetFingerprint");

      return fingerprint !== undefined && allowed.has(fingerprint);
    })
    .map((candidate) => cloneRetrievalCandidate(candidate));
}

export function mapRetrievalCandidateRow(
  row: DatabaseRow,
  source: RetrievalSource,
): RetrievalCandidate {
  return {
    citation: mapRetrievalCitation(row),
    metadata: mapRetrievalCandidateMetadata(row),
    nodeId: stringColumn(row, "node_id"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    projectionId: stringColumn(row, "projection_id"),
    score: numberColumn(row, "score"),
    source,
  };
}

export function cloneRetrievalCitation(citation: RetrievalCitation): RetrievalCitation {
  return {
    artifactHash: citation.artifactHash,
    documentAssetId: citation.documentAssetId,
    documentVersion: citation.documentVersion,
    ...(citation.endOffset === undefined ? {} : { endOffset: citation.endOffset }),
    ...(citation.pageNumber === undefined ? {} : { pageNumber: citation.pageNumber }),
    sectionPath: [...citation.sectionPath],
    ...(citation.startOffset === undefined ? {} : { startOffset: citation.startOffset }),
  };
}

export function cloneRetrievalCandidate(candidate: RetrievalCandidate): RetrievalCandidate {
  return {
    citation: cloneRetrievalCitation(candidate.citation),
    metadata: cloneJsonObject(candidate.metadata),
    nodeId: candidate.nodeId,
    permissionScope: [...candidate.permissionScope],
    projectionId: candidate.projectionId,
    score: candidate.score,
    source: candidate.source,
  };
}

function hasRetrievalMetadataFilters(filters: RetrievalMetadataFilters): boolean {
  return Boolean(
    filters.createdAfter ||
      filters.createdBefore ||
      filters.documentTypes?.length ||
      filters.entities?.length ||
      filters.freshnessStatuses?.length ||
      filters.languages?.length ||
      filters.nodeIds?.length ||
      filters.nodeKinds?.length ||
      filters.sourceIds?.length ||
      filters.tags?.length,
  );
}

function candidateMatchesRetrievalMetadataFilters(
  candidate: RetrievalCandidate,
  filters: RetrievalMetadataFilters,
): boolean {
  const metadata = retrievalMetadataContainers(candidate.metadata);

  return (
    matchesOneOf(filters.documentTypes, metadataString(candidate.metadata, "documentType")) &&
    matchesOneOf(filters.sourceIds, metadataString(candidate.metadata, "sourceId")) &&
    matchesOneOf(filters.nodeIds, candidate.nodeId) &&
    matchesOneOf(filters.nodeKinds, metadataString(candidate.metadata, "nodeKind")) &&
    matchesOverlap(
      filters.entities,
      metadata.flatMap((entry) =>
        metadataStringValuesForKeys(entry, ["entities", "graphEntities", "graphEntityIds"]),
      ),
    ) &&
    matchesOverlap(
      filters.tags,
      metadata.flatMap((entry) => metadataStringValuesForKeys(entry, ["tags"])),
    ) &&
    matchesOverlap(
      filters.languages,
      metadata.flatMap((entry) => metadataStringValuesForKeys(entry, ["language", "languages"])),
    ) &&
    matchesOverlap(
      filters.freshnessStatuses,
      metadata.flatMap((entry) =>
        metadataStringValuesForKeys(entry, ["freshnessStatus", "freshnessStatuses"]),
      ),
    ) &&
    matchesCreatedAtRange(
      metadataString(candidate.metadata, "documentCreatedAt"),
      filters.createdAfter,
      filters.createdBefore,
    )
  );
}

function matchesOneOf(
  expected: readonly string[] | undefined,
  actual: string | undefined,
): boolean {
  return (
    expected === undefined ||
    expected.length === 0 ||
    (actual !== undefined && expected.includes(actual))
  );
}

function matchesOverlap(
  expected: readonly string[] | undefined,
  actual: readonly string[],
): boolean {
  return (
    expected === undefined ||
    expected.length === 0 ||
    actual.some((value) => expected.includes(value))
  );
}

function matchesCreatedAtRange(
  actual: string | undefined,
  createdAfter: string | undefined,
  createdBefore: string | undefined,
): boolean {
  if (!createdAfter && !createdBefore) {
    return true;
  }

  if (actual === undefined) {
    return false;
  }

  const timestamp = Date.parse(actual);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  return (
    (createdAfter === undefined || timestamp >= Date.parse(createdAfter)) &&
    (createdBefore === undefined || timestamp <= Date.parse(createdBefore))
  );
}

function metadataString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function metadataStringValues(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];

  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  return [];
}

function metadataStringValuesForKeys(
  metadata: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  return keys.flatMap((key) => metadataStringValues(metadata, key));
}

function retrievalMetadataContainers(metadata: Record<string, unknown>): Record<string, unknown>[] {
  return [
    metadata,
    ...(isPlainObject(metadata.nodeMetadata) ? [metadata.nodeMetadata] : []),
    ...(isPlainObject(metadata.documentMetadata) ? [metadata.documentMetadata] : []),
  ];
}

function canReadRetrievalCandidate(
  candidate: RetrievalCandidate,
  allowedPermissionScope: ReadonlySet<string>,
): boolean {
  return (
    candidate.permissionScope.length === 0 ||
    candidate.permissionScope.every((scope) => allowedPermissionScope.has(scope))
  );
}

function mapRetrievalCandidateMetadata(row: DatabaseRow): Record<string, unknown> {
  const projectionMetadata = jsonObjectColumn(row, "metadata");
  const nodeMetadata = jsonObjectColumn(row, "node_metadata");
  const documentMetadata = jsonObjectColumn(row, "document_metadata");
  const sourceId = optionalStringColumn(row, "source_id");
  const text = optionalStringColumn(row, "text");

  return {
    ...projectionMetadata,
    documentCreatedAt: stringColumn(row, "document_created_at"),
    documentMetadata,
    documentType: stringColumn(row, "document_type"),
    nodeKind: stringColumn(row, "node_kind"),
    nodeMetadata,
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(text === undefined ? {} : { text }),
  };
}

function mapRetrievalCitation(row: DatabaseRow): RetrievalCitation {
  const sourceLocation = SourceLocationSchema.parse(jsonObjectColumn(row, "source_location"));
  const startOffset = sourceLocation.startOffset ?? numberColumn(row, "start_offset");
  const endOffset = sourceLocation.endOffset ?? numberColumn(row, "end_offset");

  return {
    artifactHash: stringColumn(row, "artifact_hash"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    documentVersion: numberColumn(row, "document_version"),
    endOffset,
    ...(sourceLocation.pageNumber === undefined ? {} : { pageNumber: sourceLocation.pageNumber }),
    sectionPath: [...sourceLocation.sectionPath],
    startOffset,
  };
}
