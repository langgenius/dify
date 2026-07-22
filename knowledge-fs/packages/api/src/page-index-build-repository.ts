import { createHash } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type DocumentOutline,
  type DocumentOutlineNode,
  DocumentOutlineSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import { deterministicChildId } from "./api-shared-utils";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";
import {
  PageIndexMaxTermBytes,
  PageIndexMaxTermChars,
  PageIndexTokenizerVersion,
  pageIndexTextTerms,
} from "./page-index-scoring";

export type PageIndexBuildStatus = "building" | "ready";

export interface MaterializePageIndexInput {
  readonly builtAt: string;
  readonly outline: DocumentOutline;
  readonly tenantId: string;
}

export interface PageIndexBuildManifest {
  readonly checksum: string;
  readonly documentAssetId: string;
  readonly documentOutlineId: string;
  readonly documentVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly nodeCount: number;
  readonly publicationGenerationId: string;
  readonly status: PageIndexBuildStatus;
  readonly termCount: number;
  readonly tokenizerVersion: typeof PageIndexTokenizerVersion;
}

export interface PublishedPageIndexBuildRepository {
  hasCompleteBuild(input: {
    readonly outline: DocumentOutline;
    readonly tenantId: string;
  }): Promise<boolean>;
  materializeBuilding(input: MaterializePageIndexInput): Promise<PageIndexBuildManifest>;
  promotePublishedBuild(input: PromotePublishedPageIndexBuildInput): Promise<void>;
}

export interface PromotePublishedPageIndexBuildInput {
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly outlineId: string;
  readonly publicationGenerationId: string;
  readonly publicationId: string;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface DatabasePublishedPageIndexBuildRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxNodesPerOutline: number;
  readonly maxTermRowsPerOutline: number;
  readonly writeBatchSize: number;
}

export class PageIndexBuildLimitExceededError extends Error {
  constructor(limitName: "maxNodesPerOutline" | "maxTermRowsPerOutline", limit: number) {
    super(`PageIndex materialization exceeded ${limitName}=${limit}`);
    this.name = "PageIndexBuildLimitExceededError";
  }
}

export class PageIndexBuildTermLengthExceededError extends Error {
  constructor() {
    super(
      `PageIndex materialization term exceeds max characters=${PageIndexMaxTermChars} or max bytes=${PageIndexMaxTermBytes}`,
    );
    this.name = "PageIndexBuildTermLengthExceededError";
  }
}

export class PageIndexEmptyBuildError extends Error {
  constructor() {
    super("PageIndex materialization requires at least one node and one indexed term");
    this.name = "PageIndexEmptyBuildError";
  }
}

export class PageIndexBuildPromotionConflictError extends Error {
  constructor() {
    super("PageIndex build no longer belongs to the requested published snapshot");
    this.name = "PageIndexBuildPromotionConflictError";
  }
}

/**
 * A generation-scoped PageIndex is a create-once projection.  A retry may
 * observe either the building or ready state, but it may never replace the
 * manifest or its child closure with different content.
 */
export class PageIndexGenerationBuildConflictError extends Error {
  readonly code = "GENERATION_SCOPED_COMPONENT_CONFLICT";

  constructor() {
    super("Generation-scoped PageIndex build already exists with different content");
    this.name = "PageIndexGenerationBuildConflictError";
  }
}

export class PageIndexReadyBuildConflictError extends PageIndexGenerationBuildConflictError {
  constructor() {
    super();
    this.message =
      "Ready PageIndex build is immutable and does not match the requested materialization";
    this.name = "PageIndexReadyBuildConflictError";
  }
}

interface MaterializedPageIndexNode {
  readonly endOffset?: number | undefined;
  readonly id: string;
  readonly level: number;
  readonly outlineNodeId: string;
  readonly parentOutlineNodeId?: string | undefined;
  readonly sectionPath: readonly string[];
  readonly startOffset?: number | undefined;
  readonly summary?: string | undefined;
  readonly title: string;
  readonly tocSource: DocumentOutlineNode["tocSource"];
  readonly visitedNodeIds: readonly string[];
}

interface MaterializedPageIndexTerm {
  readonly fieldMask: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly nodeId: string;
  readonly term: string;
}

interface MaterializedPageIndex {
  readonly manifest: PageIndexBuildManifest;
  readonly nodes: readonly MaterializedPageIndexNode[];
  readonly terms: readonly MaterializedPageIndexTerm[];
}

export function createInMemoryPublishedPageIndexBuildRepository(options: {
  readonly maxNodesPerOutline: number;
  readonly maxTermRowsPerOutline: number;
}): PublishedPageIndexBuildRepository {
  validatePositiveInteger(options.maxNodesPerOutline, "maxNodesPerOutline");
  validatePositiveInteger(options.maxTermRowsPerOutline, "maxTermRowsPerOutline");
  const builds = new Map<string, MaterializedPageIndex>();

  return {
    materializeBuilding: async ({ outline: rawOutline, tenantId }) => {
      TenantIdSchema.parse(tenantId);
      const build = materializePageIndex(rawOutline, options);
      const previous = builds.get(build.manifest.id);
      if (previous) {
        if (!completeBuildMatches(previous, build)) {
          throw pageIndexReplayConflict(previous.manifest.status);
        }
        return { ...previous.manifest };
      }
      const persisted = {
        ...build,
        manifest: {
          ...build.manifest,
          status: "building",
        },
      } satisfies MaterializedPageIndex;
      builds.set(build.manifest.id, persisted);
      return { ...persisted.manifest };
    },
    hasCompleteBuild: async ({ outline, tenantId }) => {
      TenantIdSchema.parse(tenantId);
      const expected = materializePageIndex(outline, options);
      const actual = builds.get(expected.manifest.id);
      return actual !== undefined && completeBuildMatches(actual, expected);
    },
    promotePublishedBuild: async (input) => {
      const generationId = PublicationGenerationIdSchema.parse(input.publicationGenerationId);
      const manifestId = pageIndexManifestId(UuidSchema.parse(input.outlineId), generationId);
      const build = builds.get(manifestId);
      if (
        !build ||
        build.manifest.knowledgeSpaceId !== UuidSchema.parse(input.knowledgeSpaceId) ||
        build.manifest.publicationGenerationId !== generationId
      ) {
        throw new PageIndexBuildPromotionConflictError();
      }
      builds.set(manifestId, {
        ...build,
        manifest: { ...build.manifest, status: "ready" },
      });
    },
  };
}

export function createDatabasePublishedPageIndexBuildRepository({
  database,
  maxNodesPerOutline,
  maxTermRowsPerOutline,
  writeBatchSize,
}: DatabasePublishedPageIndexBuildRepositoryOptions): PublishedPageIndexBuildRepository {
  validatePositiveInteger(maxNodesPerOutline, "maxNodesPerOutline");
  validatePositiveInteger(maxTermRowsPerOutline, "maxTermRowsPerOutline");
  validatePositiveInteger(writeBatchSize, "writeBatchSize");
  const limits = { maxNodesPerOutline, maxTermRowsPerOutline };

  return {
    materializeBuilding: async ({ outline: rawOutline, builtAt, tenantId: rawTenantId }) => {
      const outline = DocumentOutlineSchema.parse(rawOutline);
      const tenantId = TenantIdSchema.parse(rawTenantId);
      const build = materializePageIndex(outline, limits);
      let persistedStatus: PageIndexBuildStatus = "building";
      await database.transaction(async (transaction) => {
        // The outline row is the portable per-build mutex for both PostgreSQL and
        // TiDB. It closes the select-then-insert race without broad space-level locks.
        await lockPageIndexSourceOutline(transaction, database, outline, tenantId);
        const existing = await readLockedDatabasePageIndex(transaction, database, build.manifest);
        if (existing) {
          if (!completeDatabaseBuildMatches(existing, build)) {
            throw pageIndexReplayConflict(existing.manifest.status);
          }
          persistedStatus = existing.manifest.status;
          return;
        }
        await transaction.execute(pageIndexManifestInsert(database, build.manifest, builtAt));
        for (const batch of batches(build.nodes, writeBatchSize)) {
          await transaction.execute(pageIndexNodeInsert(database, build.manifest.id, batch));
        }
        for (const batch of batches(build.terms, writeBatchSize)) {
          await transaction.execute(
            pageIndexTermInsert(
              database,
              build.manifest.knowledgeSpaceId,
              build.manifest.id,
              batch,
            ),
          );
        }
      });

      return { ...build.manifest, status: persistedStatus };
    },
    hasCompleteBuild: async ({ outline: rawOutline, tenantId: rawTenantId }) => {
      const outline = DocumentOutlineSchema.parse(rawOutline);
      const tenantId = TenantIdSchema.parse(rawTenantId);
      const expected = materializePageIndex(outline, limits);
      return database.transaction(async (transaction) => {
        await lockPageIndexSourceOutline(transaction, database, outline, tenantId);
        const actual = await readLockedDatabasePageIndex(transaction, database, expected.manifest);
        return actual !== undefined && completeDatabaseBuildMatches(actual, expected);
      });
    },
    promotePublishedBuild: async (rawInput) => {
      const input = normalizePromotionInput(rawInput);
      await database.transaction(async (transaction) => {
        const snapshot = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.publicationId,
            input.fingerprint,
            input.outlineId,
            input.publicationGenerationId,
          ],
          sql: `SELECT m.${quoted(database, "id")} AS ${quoted(
            database,
            "manifest_id",
          )} FROM ${quoted(database, "projection_set_publications")} pub JOIN ${quoted(
            database,
            "projection_set_publication_members",
          )} pm ON pm.${quoted(database, "tenant_id")} = pub.${quoted(
            database,
            "tenant_id",
          )} AND pm.${quoted(database, "knowledge_space_id")} = pub.${quoted(
            database,
            "knowledge_space_id",
          )} AND pm.${quoted(database, "publication_id")} = pub.${quoted(
            database,
            "id",
          )} JOIN ${quoted(database, "document_outlines")} o ON o.${quoted(
            database,
            "id",
          )} = pm.${quoted(database, "component_key")} AND o.${quoted(
            database,
            "knowledge_space_id",
          )} = pm.${quoted(database, "knowledge_space_id")} AND o.${quoted(
            database,
            "document_asset_id",
          )} = pm.${quoted(database, "document_asset_id")} AND o.${quoted(
            database,
            "publication_generation_id",
          )} = pm.${quoted(database, "generation_id")} JOIN ${quoted(
            database,
            "page_index_manifests",
          )} m ON m.${quoted(
            database,
            "knowledge_space_id",
          )} = pm.${quoted(database, "knowledge_space_id")} AND m.${quoted(
            database,
            "document_outline_id",
          )} = pm.${quoted(database, "component_key")} AND m.${quoted(
            database,
            "publication_generation_id",
          )} = pm.${quoted(database, "generation_id")} AND m.${quoted(
            database,
            "document_asset_id",
          )} = o.${quoted(database, "document_asset_id")} AND m.${quoted(
            database,
            "document_version",
          )} = o.${quoted(database, "version")} WHERE pub.${quoted(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, 1)} AND pub.${quoted(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 2)} AND pub.${quoted(
            database,
            "id",
          )} = ${databasePlaceholder(database, 3)} AND pub.${quoted(
            database,
            "fingerprint",
          )} = ${databasePlaceholder(database, 4)} AND pub.${quoted(
            database,
            "status",
          )} IN ('published', 'superseded') AND pm.${quoted(
            database,
            "component_type",
          )} = 'document-outline' AND pm.${quoted(
            database,
            "component_key",
          )} = ${databasePlaceholder(database, 5)} AND pm.${quoted(
            database,
            "generation_id",
          )} = ${databasePlaceholder(database, 6)} AND m.${quoted(
            database,
            "tokenizer_version",
          )} = '${PageIndexTokenizerVersion}' LIMIT 1${database.dialect === "postgres" ? " FOR UPDATE" : " FOR UPDATE"};`,
          tableName: "page_index_manifests",
        });
        const manifestId = snapshot.rows[0]
          ? stringColumn(snapshot.rows[0], "manifest_id")
          : undefined;
        if (!manifestId) {
          throw new PageIndexBuildPromotionConflictError();
        }
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.updatedAt, manifestId],
          sql: `UPDATE ${quoted(database, "page_index_manifests")} SET ${quoted(
            database,
            "status",
          )} = 'ready', ${quoted(database, "updated_at")} = ${databasePlaceholder(
            database,
            1,
          )} WHERE ${quoted(database, "id")} = ${databasePlaceholder(database, 2)} AND ${quoted(
            database,
            "status",
          )} IN ('building', 'ready');`,
          tableName: "page_index_manifests",
        });
      });
    },
  };
}

function materializePageIndex(
  rawOutline: DocumentOutline,
  limits: { readonly maxNodesPerOutline: number; readonly maxTermRowsPerOutline: number },
): MaterializedPageIndex {
  const outline = DocumentOutlineSchema.parse(rawOutline);
  const generationId = PublicationGenerationIdSchema.parse(outline.publicationGenerationId);
  const manifestId = pageIndexManifestId(outline.id, generationId);
  const nodes: MaterializedPageIndexNode[] = [];
  const terms: MaterializedPageIndexTerm[] = [];
  const seenNodeIds = new Set<string>();

  const visit = (
    node: DocumentOutlineNode,
    parentOutlineNodeId: string | undefined,
    ancestors: readonly string[],
  ) => {
    if (seenNodeIds.has(node.id)) {
      throw new Error(`PageIndex outline contains duplicate node id=${node.id}`);
    }
    seenNodeIds.add(node.id);
    if (nodes.length >= limits.maxNodesPerOutline) {
      throw new PageIndexBuildLimitExceededError("maxNodesPerOutline", limits.maxNodesPerOutline);
    }
    const id = deterministicChildId(manifestId, `node:${node.id}`);
    const visitedNodeIds = [...ancestors, node.id];
    nodes.push({
      ...(node.endOffset !== undefined ? { endOffset: node.endOffset } : {}),
      id,
      level: node.level,
      outlineNodeId: node.id,
      ...(parentOutlineNodeId ? { parentOutlineNodeId } : {}),
      sectionPath: [...node.sectionPath],
      ...(node.startOffset !== undefined ? { startOffset: node.startOffset } : {}),
      ...(node.summary ? { summary: node.summary } : {}),
      title: node.title,
      tocSource: node.tocSource,
      visitedNodeIds,
    });
    const masks = new Map<string, number>();
    addFieldTerms(masks, node.title, 1);
    if (node.summary) {
      addFieldTerms(masks, node.summary, 2);
    }
    addFieldTerms(masks, node.sectionPath.join(" "), 4);
    for (const [term, fieldMask] of [...masks].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (terms.length >= limits.maxTermRowsPerOutline) {
        throw new PageIndexBuildLimitExceededError(
          "maxTermRowsPerOutline",
          limits.maxTermRowsPerOutline,
        );
      }
      terms.push({
        fieldMask,
        id: deterministicChildId(id, `term:${term}`),
        knowledgeSpaceId: outline.knowledgeSpaceId,
        nodeId: id,
        term,
      });
    }
    for (const child of node.children) {
      visit(child, node.id, visitedNodeIds);
    }
  };
  for (const node of outline.nodes) {
    visit(node, undefined, []);
  }
  if (nodes.length === 0 || terms.length === 0) {
    throw new PageIndexEmptyBuildError();
  }

  const checksum = createHash("sha256")
    .update(
      stableJson({
        nodes: nodes.map(({ id: _id, ...node }) => node),
        terms: terms.map(
          ({ id: _id, knowledgeSpaceId: _knowledgeSpaceId, nodeId: _nodeId, ...term }) => term,
        ),
        tokenizerVersion: PageIndexTokenizerVersion,
      }),
    )
    .digest("hex");
  return {
    manifest: {
      checksum,
      documentAssetId: outline.documentAssetId,
      documentOutlineId: outline.id,
      documentVersion: outline.version,
      id: manifestId,
      knowledgeSpaceId: outline.knowledgeSpaceId,
      nodeCount: nodes.length,
      publicationGenerationId: generationId,
      status: "building",
      termCount: terms.length,
      tokenizerVersion: PageIndexTokenizerVersion,
    },
    nodes,
    terms,
  };
}

function addFieldTerms(target: Map<string, number>, text: string, mask: number): void {
  for (const term of pageIndexTextTerms(text)) {
    if (
      Array.from(term).length > PageIndexMaxTermChars ||
      new TextEncoder().encode(term).byteLength > PageIndexMaxTermBytes
    ) {
      throw new PageIndexBuildTermLengthExceededError();
    }
    target.set(term, (target.get(term) ?? 0) | mask);
  }
}

function pageIndexManifestId(outlineId: string, generationId: string): string {
  return deterministicChildId(outlineId, `page-index:${generationId}:${PageIndexTokenizerVersion}`);
}

function completeBuildMatches(
  actual: MaterializedPageIndex,
  expected: MaterializedPageIndex,
): boolean {
  const snapshot = (build: MaterializedPageIndex) => {
    const { status: _status, ...manifest } = build.manifest;
    return {
      manifest,
      nodes: [...build.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      terms: [...build.terms].sort((left, right) => left.id.localeCompare(right.id)),
    };
  };
  return stableJson(snapshot(actual)) === stableJson(snapshot(expected));
}

function completeDatabaseBuildMatches(
  actual: DatabasePageIndexInvariant,
  expected: MaterializedPageIndex,
): boolean {
  const { status: _actualStatus, ...actualManifest } = actual.manifest;
  const { status: _expectedStatus, ...expectedManifest } = expected.manifest;
  return (
    stableJson(actualManifest) === stableJson(expectedManifest) &&
    actual.actualNodeCount === expected.manifest.nodeCount &&
    actual.actualTermCount === expected.manifest.termCount &&
    actual.invalidTermCount === 0
  );
}

function pageIndexReplayConflict(status: PageIndexBuildStatus): Error {
  return status === "ready"
    ? new PageIndexReadyBuildConflictError()
    : new PageIndexGenerationBuildConflictError();
}

async function lockPageIndexSourceOutline(
  executor: DatabaseExecutor,
  database: DatabaseAdapter,
  expected: DocumentOutline,
  tenantId: string,
): Promise<void> {
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "parse_artifact_id",
    "artifact_hash",
    "outline_version",
    "version",
    "nodes",
    "metadata",
    "created_at",
    "updated_at",
  ];
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      tenantId,
      expected.id,
      expected.knowledgeSpaceId,
      expected.documentAssetId,
      expected.version,
      expected.publicationGenerationId ?? null,
      expected.parseArtifactId,
      expected.artifactHash,
    ],
    sql: `SELECT ${columns
      .map((column) => `o.${quoted(database, column)} AS ${quoted(database, `outline_${column}`)}`)
      .join(", ")} FROM ${quoted(database, "document_outlines")} o JOIN ${quoted(
      database,
      "knowledge_spaces",
    )} s ON s.${quoted(database, "id")} = o.${quoted(
      database,
      "knowledge_space_id",
    )} JOIN ${quoted(database, "document_assets")} da ON da.${quoted(
      database,
      "id",
    )} = o.${quoted(database, "document_asset_id")} AND da.${quoted(
      database,
      "knowledge_space_id",
    )} = o.${quoted(database, "knowledge_space_id")} AND da.${quoted(
      database,
      "version",
    )} = o.${quoted(database, "version")} JOIN ${quoted(
      database,
      "parse_artifacts",
    )} pa ON pa.${quoted(database, "id")} = o.${quoted(
      database,
      "parse_artifact_id",
    )} AND pa.${quoted(database, "document_asset_id")} = o.${quoted(
      database,
      "document_asset_id",
    )} AND pa.${quoted(database, "version")} = o.${quoted(
      database,
      "version",
    )} AND pa.${quoted(database, "artifact_hash")} = o.${quoted(
      database,
      "artifact_hash",
    )} WHERE s.${quoted(database, "tenant_id")} = ${databasePlaceholder(
      database,
      1,
    )} AND o.${quoted(database, "id")} = ${databasePlaceholder(
      database,
      2,
    )} AND o.${quoted(database, "knowledge_space_id")} = ${databasePlaceholder(
      database,
      3,
    )} AND o.${quoted(database, "document_asset_id")} = ${databasePlaceholder(
      database,
      4,
    )} AND o.${quoted(database, "version")} = ${databasePlaceholder(
      database,
      5,
    )} AND o.${quoted(database, "publication_generation_id")} = ${databasePlaceholder(
      database,
      6,
    )} AND o.${quoted(database, "parse_artifact_id")} = ${databasePlaceholder(
      database,
      7,
    )} AND o.${quoted(database, "artifact_hash")} = ${databasePlaceholder(
      database,
      8,
    )} LIMIT 1 FOR UPDATE${database.dialect === "postgres" ? " OF o, s, da, pa" : ""};`,
    tableName: "document_outlines",
  });
  const row = result.rows[0];
  if (!row || stableJson(mapBackfillOutline(row)) !== stableJson(expected)) {
    throw new PageIndexGenerationBuildConflictError();
  }
}

interface DatabasePageIndexInvariant {
  readonly actualNodeCount: number;
  readonly actualTermCount: number;
  readonly invalidTermCount: number;
  readonly manifest: PageIndexBuildManifest;
}

async function readLockedDatabasePageIndex(
  executor: DatabaseExecutor,
  database: DatabaseAdapter,
  expectedManifest: PageIndexBuildManifest,
): Promise<DatabasePageIndexInvariant | undefined> {
  const manifestResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      expectedManifest.knowledgeSpaceId,
      expectedManifest.documentOutlineId,
      expectedManifest.publicationGenerationId,
    ],
    sql: `SELECT ${[
      "id",
      "knowledge_space_id",
      "publication_generation_id",
      "document_asset_id",
      "document_outline_id",
      "document_version",
      "tokenizer_version",
      "status",
      "node_count",
      "term_count",
      "checksum",
    ]
      .map((column) => quoted(database, column))
      .join(", ")}, (SELECT COUNT(*) FROM ${quoted(
      database,
      "page_index_nodes",
    )} invariant_n WHERE invariant_n.${quoted(database, "manifest_id")} = ${quoted(
      database,
      "page_index_manifests",
    )}.${quoted(database, "id")}) AS ${quoted(
      database,
      "actual_node_count",
    )}, (SELECT COUNT(*) FROM ${quoted(
      database,
      "page_index_terms",
    )} invariant_t WHERE invariant_t.${quoted(database, "manifest_id")} = ${quoted(
      database,
      "page_index_manifests",
    )}.${quoted(database, "id")}) AS ${quoted(
      database,
      "actual_term_count",
    )}, (SELECT COUNT(*) FROM ${quoted(
      database,
      "page_index_terms",
    )} closure_t LEFT JOIN ${quoted(database, "page_index_nodes")} closure_n ON closure_n.${quoted(
      database,
      "id",
    )} = closure_t.${quoted(database, "page_index_node_id")} WHERE closure_t.${quoted(
      database,
      "manifest_id",
    )} = ${quoted(database, "page_index_manifests")}.${quoted(
      database,
      "id",
    )} AND (closure_t.${quoted(database, "knowledge_space_id")} <> ${quoted(
      database,
      "page_index_manifests",
    )}.${quoted(database, "knowledge_space_id")} OR closure_n.${quoted(
      database,
      "id",
    )} IS NULL OR closure_n.${quoted(database, "manifest_id")} <> ${quoted(
      database,
      "page_index_manifests",
    )}.${quoted(database, "id")})) AS ${quoted(
      database,
      "invalid_term_count",
    )} FROM ${quoted(database, "page_index_manifests")} WHERE ${quoted(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoted(
      database,
      "document_outline_id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoted(
      database,
      "publication_generation_id",
    )} = ${databasePlaceholder(database, 3)} LIMIT 1 FOR UPDATE;`,
    tableName: "page_index_manifests",
  });
  const manifestRow = manifestResult.rows[0];
  if (!manifestRow) {
    return undefined;
  }
  const status = stringColumn(manifestRow, "status");
  if (status !== "building" && status !== "ready") {
    throw new PageIndexGenerationBuildConflictError();
  }
  const manifest: PageIndexBuildManifest = {
    checksum: stringColumn(manifestRow, "checksum"),
    documentAssetId: stringColumn(manifestRow, "document_asset_id"),
    documentOutlineId: stringColumn(manifestRow, "document_outline_id"),
    documentVersion: numberColumn(manifestRow, "document_version"),
    id: stringColumn(manifestRow, "id"),
    knowledgeSpaceId: stringColumn(manifestRow, "knowledge_space_id"),
    nodeCount: numberColumn(manifestRow, "node_count"),
    publicationGenerationId: stringColumn(manifestRow, "publication_generation_id"),
    status,
    termCount: numberColumn(manifestRow, "term_count"),
    tokenizerVersion: stringColumn(
      manifestRow,
      "tokenizer_version",
    ) as typeof PageIndexTokenizerVersion,
  };
  return {
    actualNodeCount: numberColumn(manifestRow, "actual_node_count"),
    actualTermCount: numberColumn(manifestRow, "actual_term_count"),
    invalidTermCount: numberColumn(manifestRow, "invalid_term_count"),
    manifest,
  };
}

function pageIndexManifestInsert(
  database: DatabaseAdapter,
  manifest: PageIndexBuildManifest,
  builtAt: string,
) {
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "document_outline_id",
    "document_version",
    "tokenizer_version",
    "status",
    "node_count",
    "term_count",
    "checksum",
    "created_at",
    "updated_at",
  ];
  const params = [
    manifest.id,
    manifest.knowledgeSpaceId,
    manifest.publicationGenerationId,
    manifest.documentAssetId,
    manifest.documentOutlineId,
    manifest.documentVersion,
    manifest.tokenizerVersion,
    manifest.status,
    manifest.nodeCount,
    manifest.termCount,
    manifest.checksum,
    builtAt,
    builtAt,
  ] satisfies readonly DatabaseQueryValue[];
  return {
    maxRows: 0,
    operation: "insert" as const,
    params,
    sql: `INSERT INTO ${quoted(database, "page_index_manifests")} (${columns
      .map((column) => quoted(database, column))
      .join(", ")}) VALUES (${params
      .map((_, index) => databasePlaceholder(database, index + 1))
      .join(", ")});`,
    tableName: "page_index_manifests",
  };
}

function pageIndexNodeInsert(
  database: DatabaseAdapter,
  manifestId: string,
  nodes: readonly MaterializedPageIndexNode[],
) {
  const columns = [
    "id",
    "manifest_id",
    "outline_node_id",
    "parent_outline_node_id",
    "title",
    "summary",
    "section_path",
    "visited_node_ids",
    "level",
    "start_offset",
    "end_offset",
    "toc_source",
  ];
  const params: DatabaseQueryValue[] = [];
  const values = nodes.map((node) => {
    const row: DatabaseQueryValue[] = [
      node.id,
      manifestId,
      node.outlineNodeId,
      node.parentOutlineNodeId ?? null,
      node.title,
      node.summary ?? null,
      JSON.stringify(node.sectionPath),
      JSON.stringify(node.visitedNodeIds),
      node.level,
      node.startOffset ?? null,
      node.endOffset ?? null,
      node.tocSource,
    ];
    const placeholders = row.map((_, index) => {
      const position = params.length + index + 1;
      const column = columns[index];
      const placeholder = databasePlaceholder(database, position);
      return column === "section_path" || column === "visited_node_ids"
        ? database.dialect === "postgres"
          ? `${placeholder}::jsonb`
          : `CAST(${placeholder} AS JSON)`
        : placeholder;
    });
    params.push(...row);
    return `(${placeholders.join(", ")})`;
  });
  return {
    maxRows: 0,
    operation: "insert" as const,
    params,
    sql: `INSERT INTO ${quoted(database, "page_index_nodes")} (${columns
      .map((column) => quoted(database, column))
      .join(", ")}) VALUES ${values.join(", ")};`,
    tableName: "page_index_nodes",
  };
}

function pageIndexTermInsert(
  database: DatabaseAdapter,
  knowledgeSpaceId: string,
  manifestId: string,
  terms: readonly MaterializedPageIndexTerm[],
) {
  const params: DatabaseQueryValue[] = [];
  const values = terms.map((term) => {
    const row = [
      term.id,
      knowledgeSpaceId,
      manifestId,
      term.nodeId,
      term.term,
      term.fieldMask,
    ] satisfies readonly DatabaseQueryValue[];
    const placeholders = row.map((_, index) =>
      databasePlaceholder(database, params.length + index + 1),
    );
    params.push(...row);
    return `(${placeholders.join(", ")})`;
  });
  return {
    maxRows: 0,
    operation: "insert" as const,
    params,
    sql: `INSERT INTO ${quoted(database, "page_index_terms")} (${[
      "id",
      "knowledge_space_id",
      "manifest_id",
      "page_index_node_id",
      "term",
      "field_mask",
    ]
      .map((column) => quoted(database, column))
      .join(", ")}) VALUES ${values.join(", ")};`,
    tableName: "page_index_terms",
  };
}

function normalizePromotionInput(input: PromotePublishedPageIndexBuildInput) {
  return {
    fingerprint: input.fingerprint.trim(),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    outlineId: UuidSchema.parse(input.outlineId),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
    publicationId: UuidSchema.parse(input.publicationId),
    tenantId: TenantIdSchema.parse(input.tenantId),
    updatedAt: input.updatedAt,
  };
}

function batches<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function quoted(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex build ${name} must be at least 1`);
  }
}

export interface PublishedPageIndexBackfillCursor {
  readonly componentKey: string;
  readonly publicationId: string;
}

export interface BackfillPublishedPageIndexPageInput {
  readonly cursor?: PublishedPageIndexBackfillCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface BackfillPublishedPageIndexPageResult {
  readonly built: number;
  readonly nextCursor?: PublishedPageIndexBackfillCursor | undefined;
}

export interface PublishedPageIndexBackfillService {
  backfillPage(
    input: BackfillPublishedPageIndexPageInput,
  ): Promise<BackfillPublishedPageIndexPageResult>;
}

/**
 * @deprecated Retired because it scans arbitrary published/superseded publications and promotes
 * each manifest independently. Use the frozen-head `PageIndexUpgradeBackfillRepository` ledger.
 */
export function createDatabasePublishedPageIndexBackfillService(options: {
  readonly builds: PublishedPageIndexBuildRepository;
  readonly database: DatabaseAdapter;
  readonly maxPageSize: number;
}): PublishedPageIndexBackfillService {
  if (unsafeArbitraryPublicationBackfillIsRetired()) {
    throw new Error(
      "Unsafe arbitrary-publication PageIndex backfill is retired; use the durable frozen-head upgrade runtime",
    );
  }
  /* v8 ignore start -- retained only as source compatibility for callers that receive the error. */
  validatePositiveInteger(options.maxPageSize, "maxPageSize");
  return {
    backfillPage: async (rawInput) => {
      if (
        !Number.isSafeInteger(rawInput.limit) ||
        rawInput.limit < 1 ||
        rawInput.limit > options.maxPageSize
      ) {
        throw new Error(`PageIndex backfill limit must be between 1 and ${options.maxPageSize}`);
      }
      const tenantId = TenantIdSchema.parse(rawInput.tenantId);
      const knowledgeSpaceId = UuidSchema.parse(rawInput.knowledgeSpaceId);
      const params: DatabaseQueryValue[] = [tenantId, knowledgeSpaceId];
      const cursorSql = rawInput.cursor
        ? (() => {
            const publicationId = UuidSchema.parse(rawInput.cursor.publicationId);
            const componentKey = UuidSchema.parse(rawInput.cursor.componentKey);
            params.push(publicationId, publicationId, componentKey);
            return ` AND (pm.${quoted(options.database, "publication_id")} > ${databasePlaceholder(
              options.database,
              3,
            )} OR (pm.${quoted(options.database, "publication_id")} = ${databasePlaceholder(
              options.database,
              4,
            )} AND pm.${quoted(options.database, "component_key")} > ${databasePlaceholder(
              options.database,
              5,
            )}))`;
          })()
        : "";
      params.push(rawInput.limit + 1);
      const result = await options.database.execute({
        maxRows: rawInput.limit + 1,
        operation: "select",
        params,
        sql: `${backfillOutlineSelect(options.database)} FROM ${quoted(
          options.database,
          "projection_set_publications",
        )} pub JOIN ${quoted(options.database, "projection_set_publication_members")} pm ON pm.${quoted(
          options.database,
          "tenant_id",
        )} = pub.${quoted(options.database, "tenant_id")} AND pm.${quoted(
          options.database,
          "knowledge_space_id",
        )} = pub.${quoted(options.database, "knowledge_space_id")} AND pm.${quoted(
          options.database,
          "publication_id",
        )} = pub.${quoted(options.database, "id")} JOIN ${quoted(
          options.database,
          "document_outlines",
        )} o ON o.${quoted(options.database, "id")} = pm.${quoted(
          options.database,
          "component_key",
        )} AND o.${quoted(options.database, "publication_generation_id")} = pm.${quoted(
          options.database,
          "generation_id",
        )} LEFT JOIN ${quoted(options.database, "page_index_manifests")} m ON m.${quoted(
          options.database,
          "knowledge_space_id",
        )} = pm.${quoted(options.database, "knowledge_space_id")} AND m.${quoted(
          options.database,
          "document_outline_id",
        )} = pm.${quoted(options.database, "component_key")} AND m.${quoted(
          options.database,
          "publication_generation_id",
        )} = pm.${quoted(options.database, "generation_id")} AND m.${quoted(
          options.database,
          "status",
        )} = 'ready' AND m.${quoted(options.database, "tokenizer_version")} = '${
          PageIndexTokenizerVersion
        }' WHERE pub.${quoted(options.database, "tenant_id")} = ${databasePlaceholder(
          options.database,
          1,
        )} AND pub.${quoted(options.database, "knowledge_space_id")} = ${databasePlaceholder(
          options.database,
          2,
        )} AND pub.${quoted(options.database, "status")} IN ('published', 'superseded') AND pm.${quoted(
          options.database,
          "component_type",
        )} = 'document-outline' AND m.${quoted(options.database, "id")} IS NULL${cursorSql} ORDER BY pm.${quoted(
          options.database,
          "publication_id",
        )} ASC, pm.${quoted(options.database, "component_key")} ASC LIMIT ${databasePlaceholder(
          options.database,
          params.length,
        )};`,
        tableName: "projection_set_publication_members",
      });
      const rows = result.rows.slice(0, rawInput.limit);
      for (const row of rows) {
        const outline = mapBackfillOutline(row);
        await options.builds.materializeBuilding({
          builtAt: rawInput.updatedAt,
          outline,
          tenantId,
        });
        await options.builds.promotePublishedBuild({
          fingerprint: stringColumn(row, "publication_fingerprint"),
          knowledgeSpaceId,
          outlineId: outline.id,
          publicationGenerationId: PublicationGenerationIdSchema.parse(
            outline.publicationGenerationId,
          ),
          publicationId: stringColumn(row, "publication_id"),
          tenantId,
          updatedAt: rawInput.updatedAt,
        });
      }
      const last = rows.at(-1);
      return {
        built: rows.length,
        ...(result.rows.length > rawInput.limit && last
          ? {
              nextCursor: {
                componentKey: stringColumn(last, "outline_id"),
                publicationId: stringColumn(last, "publication_id"),
              },
            }
          : {}),
      };
    },
  };
  /* v8 ignore stop */
}

function unsafeArbitraryPublicationBackfillIsRetired(): boolean {
  return true;
}

function backfillOutlineSelect(database: DatabaseAdapter): string {
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "parse_artifact_id",
    "artifact_hash",
    "outline_version",
    "version",
    "nodes",
    "metadata",
    "created_at",
    "updated_at",
  ];
  return `SELECT pub.${quoted(database, "id")} AS ${quoted(
    database,
    "publication_id",
  )}, pub.${quoted(database, "fingerprint")} AS ${quoted(
    database,
    "publication_fingerprint",
  )}, ${columns
    .map((column) => `o.${quoted(database, column)} AS ${quoted(database, `outline_${column}`)}`)
    .join(", ")}`;
}

function mapBackfillOutline(row: DatabaseRow): DocumentOutline {
  const updatedAt = optionalStringColumn(row, "outline_updated_at");
  return DocumentOutlineSchema.parse({
    artifactHash: stringColumn(row, "outline_artifact_hash"),
    createdAt: stringColumn(row, "outline_created_at"),
    documentAssetId: stringColumn(row, "outline_document_asset_id"),
    id: stringColumn(row, "outline_id"),
    knowledgeSpaceId: stringColumn(row, "outline_knowledge_space_id"),
    metadata: jsonObjectColumn(row, "outline_metadata"),
    nodes: jsonArrayColumn(row, "outline_nodes"),
    outlineVersion: stringColumn(row, "outline_outline_version"),
    parseArtifactId: stringColumn(row, "outline_parse_artifact_id"),
    publicationGenerationId: stringColumn(row, "outline_publication_generation_id"),
    version: numberColumn(row, "outline_version"),
    ...(updatedAt ? { updatedAt } : {}),
  });
}
