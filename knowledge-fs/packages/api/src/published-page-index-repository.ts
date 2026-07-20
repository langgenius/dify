import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type DocumentOutline,
  type DocumentOutlineNode,
  DocumentOutlineSchema,
  DocumentOutlineTocSourceSchema,
  type IndexProjection,
  IndexProjectionSchema,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type { DocumentAssetRepository } from "./document-asset-repository";
import { readableDocumentParentSourcePredicateSql } from "./document-asset-visibility-sql";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import {
  type GetManyIndexProjectionsInput,
  cloneIndexProjection,
} from "./index-projection-repository";
import {
  cloneJsonObject,
  jsonArrayColumn,
  jsonObjectColumn,
  jsonStringArrayColumn,
} from "./json-utils";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import {
  PageIndexMaxQueryTerms,
  PageIndexMaxTermBytes,
  PageIndexMaxTermChars,
  PageIndexTokenizerVersion,
  scorePageIndexOutlineNode,
} from "./page-index-scoring";
import type {
  ProjectionSetPublicationMember,
  ProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";
import type { RetrievalCitation } from "./retrieval-candidates";

export interface PublishedPageIndexScope {
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly tenantId: string;
}

export interface PublishedPageIndexOutlineCursor {
  readonly componentKey: string;
}

export interface PublishedPageIndexOutlineItem {
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly outline: DocumentOutline;
  readonly publicationId: string;
}

export interface ListPublishedPageIndexOutlinesInput extends PublishedPageIndexScope {
  readonly cursor?: PublishedPageIndexOutlineCursor | undefined;
  readonly limit: number;
  /** Required caller grants; omission is intentionally not representable. */
  readonly permissionScope: readonly string[];
}

export interface ListPublishedPageIndexOutlinesResult {
  /** Optional internal diagnostic; callers must not expose hidden-outline counts to end users. */
  readonly filteredCount?: number | undefined;
  readonly items: readonly PublishedPageIndexOutlineItem[];
  readonly nextCursor?: PublishedPageIndexOutlineCursor | undefined;
}

export interface OpenPublishedPageIndexLeafEvidenceInput extends PublishedPageIndexScope {
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly limit: number;
  readonly outlineId: string;
  readonly outlineNodeId: string;
  /** Caller grants. A node is readable only when every required node scope is present. */
  readonly permissionScope: readonly string[];
}

export interface PublishedPageIndexLeafEvidence {
  readonly citation: RetrievalCitation;
  readonly node: KnowledgeNode;
  readonly outlineId: string;
  readonly outlineNodeId: string;
  readonly projections: readonly {
    readonly id: string;
    readonly type?: IndexProjection["type"] | undefined;
  }[];
}

export interface OpenPublishedPageIndexLeafEvidenceResult {
  readonly items: readonly PublishedPageIndexLeafEvidence[];
  readonly openedRange: {
    readonly endOffset: number;
    readonly startOffset: number;
  };
  readonly outline: DocumentOutline;
  readonly selectedNode: DocumentOutlineNode;
  readonly truncated?: boolean | undefined;
}

export interface SearchPublishedPageIndexSectionsInput extends PublishedPageIndexScope {
  readonly limit: number;
  readonly permissionScope: readonly string[];
  readonly scoreThreshold?: number | undefined;
  /** Exact terms produced by the shared NFKC PageIndex tokenizer. */
  readonly terms: readonly string[];
}

export interface PublishedPageIndexSectionSearchItem {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly generationId: string;
  readonly node: DocumentOutlineNode;
  readonly outlineId: string;
  readonly outlineVersion: string;
  readonly score: number;
  readonly visitedNodeIds: readonly string[];
}

export interface SearchPublishedPageIndexSectionsResult {
  /** Number of bounded candidates rejected by scoreThreshold before limit is applied. */
  readonly filteredCount?: number | undefined;
  readonly items: readonly PublishedPageIndexSectionSearchItem[];
  readonly tokenizerVersion: typeof PageIndexTokenizerVersion;
  /** True when either the section result or the bounded posting window had more rows. */
  readonly truncated: boolean;
}

export interface PublishedPageIndexRepository {
  listOutlines(
    input: ListPublishedPageIndexOutlinesInput,
  ): Promise<ListPublishedPageIndexOutlinesResult>;
  openLeafEvidence(
    input: OpenPublishedPageIndexLeafEvidenceInput,
  ): Promise<OpenPublishedPageIndexLeafEvidenceResult>;
  /** Present only when bounded flattened/inverted PageIndex search is available. */
  searchSections?(
    input: SearchPublishedPageIndexSectionsInput,
  ): Promise<SearchPublishedPageIndexSectionsResult>;
}

export interface InMemoryPublishedPageIndexRepositoryOptions {
  readonly documentAssets: Pick<DocumentAssetRepository, "get">;
  readonly indexProjections: {
    getMany(input: GetManyIndexProjectionsInput): Promise<IndexProjection[]>;
  };
  readonly maxLeafLimit: number;
  readonly maxOutlinePageSize: number;
  readonly maxProjectionMembers: number;
  readonly members: Pick<ProjectionSetPublicationMemberRepository, "listByPublication">;
  readonly nodes: Pick<KnowledgeNodeRepository, "get">;
  readonly outlines: Pick<DocumentOutlineRepository, "getById">;
  readonly publications: Pick<ProjectionSetPublicationRepository, "getByFingerprint">;
}

export interface DatabasePublishedPageIndexRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxLeafLimit: number;
  readonly maxOutlinePageSize: number;
  readonly maxProjectionRows: number;
  /** Applied to relevance-ranked section nodes after exact-term aggregation. */
  readonly maxSectionCandidateNodes?: number | undefined;
}

export class PublishedPageIndexSnapshotNotFoundError extends Error {
  constructor() {
    super("Published PageIndex snapshot was not found in the requested tenant-space scope");
    this.name = "PublishedPageIndexSnapshotNotFoundError";
  }
}

export class PublishedPageIndexOutlineNotFoundError extends Error {
  constructor() {
    super("Published PageIndex outline was not found in the requested publication snapshot");
    this.name = "PublishedPageIndexOutlineNotFoundError";
  }
}

export class PublishedPageIndexNodeNotFoundError extends Error {
  constructor(outlineNodeId: string) {
    super(`Published PageIndex outline node ${outlineNodeId} was not found`);
    this.name = "PublishedPageIndexNodeNotFoundError";
  }
}

export class PublishedPageIndexRangeUnavailableError extends Error {
  constructor(outlineNodeId: string) {
    super(`Published PageIndex outline node ${outlineNodeId} does not define a non-empty range`);
    this.name = "PublishedPageIndexRangeUnavailableError";
  }
}

export class PublishedPageIndexProjectionLimitExceededError extends Error {
  constructor(maxProjectionMembers: number) {
    super(
      `Published PageIndex projection membership exceeds maxProjectionMembers=${maxProjectionMembers}`,
    );
    this.name = "PublishedPageIndexProjectionLimitExceededError";
  }
}

// Implementations follow below. Keeping the public contract at the top makes query-path wiring
// independent from the database/reference adapter used by the application.

export function createInMemoryPublishedPageIndexRepository({
  documentAssets,
  indexProjections,
  maxLeafLimit,
  maxOutlinePageSize,
  maxProjectionMembers,
  members,
  nodes,
  outlines,
  publications,
}: InMemoryPublishedPageIndexRepositoryOptions): PublishedPageIndexRepository {
  validateBounds({ maxLeafLimit, maxOutlinePageSize, maxProjectionRows: maxProjectionMembers });

  const loadSnapshot = async (scope: PublishedPageIndexScope) => {
    const normalized = normalizeScope(scope);
    const publication = await publications.getByFingerprint({
      fingerprint: normalized.fingerprint,
      knowledgeSpaceId: normalized.knowledgeSpaceId,
      tenantId: normalized.tenantId,
    });

    if (
      !publication ||
      publication.id !== normalized.publicationId ||
      publication.fingerprint !== normalized.fingerprint ||
      publication.knowledgeSpaceId !== normalized.knowledgeSpaceId ||
      publication.tenantId !== normalized.tenantId ||
      (publication.status !== "published" && publication.status !== "superseded")
    ) {
      throw new PublishedPageIndexSnapshotNotFoundError();
    }

    const loadedMembers = await members.listByPublication({
      fingerprint: normalized.fingerprint,
      knowledgeSpaceId: normalized.knowledgeSpaceId,
      tenantId: normalized.tenantId,
    });
    const publicationMembers = loadedMembers.filter(
      (member) =>
        member.tenantId === normalized.tenantId &&
        member.knowledgeSpaceId === normalized.knowledgeSpaceId &&
        member.publicationId === normalized.publicationId,
    );
    if (publicationMembers.length !== loadedMembers.length) {
      // A repository result is part of the immutable publication proof. Silently dropping a
      // cross-tenant/publication member would turn corruption into an apparently valid partial
      // snapshot, so the reference implementation fails the entire promotion/read closure.
      throw new PublishedPageIndexSnapshotNotFoundError();
    }
    const projectionMembers = publicationMembers.filter(
      (member) => member.componentType === "index-projection",
    );

    if (projectionMembers.length > maxProjectionMembers) {
      throw new PublishedPageIndexProjectionLimitExceededError(maxProjectionMembers);
    }

    const persistedProjections = await indexProjections.getMany({
      ids: projectionMembers.map((member) => member.componentKey),
      knowledgeSpaceId: normalized.knowledgeSpaceId,
    });
    const projectionsById = new Map(
      persistedProjections.map((projection) => [projection.id, projection]),
    );

    return { normalized, projectionMembers, projectionsById, publicationMembers };
  };

  const loadOwnedNode = async ({
    documentAssetId,
    generationId,
    member,
    normalized,
    projectionsById,
  }: {
    readonly documentAssetId: string;
    readonly generationId: string;
    readonly member: ProjectionSetPublicationMember;
    readonly normalized: NormalizedPublishedPageIndexScope;
    readonly projectionsById: ReadonlyMap<string, IndexProjection>;
  }): Promise<{ readonly node: KnowledgeNode; readonly projection: IndexProjection } | null> => {
    const projection = projectionsById.get(member.componentKey);

    if (
      !projection ||
      projection.id !== member.componentKey ||
      projection.knowledgeSpaceId !== normalized.knowledgeSpaceId ||
      projection.publicationGenerationId !== member.generationId ||
      projection.status !== "ready" ||
      member.generationId !== generationId ||
      member.documentAssetId !== documentAssetId
    ) {
      return null;
    }

    const node = await nodes.get({
      id: projection.nodeId,
      knowledgeSpaceId: normalized.knowledgeSpaceId,
      publicationGenerationId: member.generationId,
    });

    return node &&
      node.kind !== "summary" &&
      node.documentAssetId === documentAssetId &&
      node.publicationGenerationId === member.generationId
      ? { node, projection }
      : null;
  };

  const loadReadableNode = async (
    input: Parameters<typeof loadOwnedNode>[0] & { readonly allowed: ReadonlySet<string> },
  ): Promise<{ readonly node: KnowledgeNode; readonly projection: IndexProjection } | null> => {
    const owned = await loadOwnedNode(input);
    return owned && canReadNode(owned.node, input.allowed) ? owned : null;
  };

  const requireReadableOutline = async ({
    allowed,
    documentAssetId,
    generationId,
    normalized,
    outlineId,
    projectionMembers,
    projectionsById,
    publicationMembers,
  }: Awaited<ReturnType<typeof loadSnapshot>> & {
    readonly allowed: ReadonlySet<string>;
    readonly documentAssetId: string;
    readonly generationId: string;
    readonly outlineId: string;
  }): Promise<DocumentOutline> => {
    const member = publicationMembers.find(
      (candidate) =>
        candidate.componentType === "document-outline" &&
        candidate.componentKey === outlineId &&
        candidate.generationId === generationId &&
        candidate.documentAssetId === documentAssetId,
    );

    if (!member) {
      throw new PublishedPageIndexOutlineNotFoundError();
    }

    const [outline, asset] = await Promise.all([
      outlines.getById({ id: outlineId }),
      documentAssets.get({ id: documentAssetId, knowledgeSpaceId: normalized.knowledgeSpaceId }),
    ]);

    if (
      !outline ||
      !asset ||
      asset.parserStatus !== "parsed" ||
      outline.id !== member.componentKey ||
      outline.knowledgeSpaceId !== normalized.knowledgeSpaceId ||
      outline.publicationGenerationId !== member.generationId ||
      outline.documentAssetId !== member.documentAssetId
    ) {
      throw new PublishedPageIndexOutlineNotFoundError();
    }

    let eligibleNodeCount = 0;
    for (const projectionMember of projectionMembers) {
      if (
        projectionMember.generationId !== generationId ||
        projectionMember.documentAssetId !== documentAssetId
      ) {
        continue;
      }

      const owned = await loadOwnedNode({
        documentAssetId,
        generationId,
        member: projectionMember,
        normalized,
        projectionsById,
      });

      if (
        !owned ||
        owned.node.parseArtifactId !== outline.parseArtifactId ||
        owned.node.artifactHash !== outline.artifactHash
      ) {
        continue;
      }

      eligibleNodeCount += 1;
      if (!canReadNode(owned.node, allowed)) {
        // An Outline summary may aggregate every node in its artifact. Returning the whole
        // Outline after finding only one readable node would expose titles/summaries derived from
        // a sibling node the caller cannot read. Until PageIndex stores node-level ACL summaries,
        // mixed-ACL documents are deliberately all-or-nothing at the Outline boundary.
        throw new PublishedPageIndexOutlineNotFoundError();
      }
    }

    if (eligibleNodeCount > 0) {
      return cloneOutline(outline);
    }

    // Keep missing membership, corrupt lineage, and ACL denial indistinguishable to callers.
    throw new PublishedPageIndexOutlineNotFoundError();
  };

  return {
    searchSections: async (input) => {
      validateLimit(input.limit, maxOutlinePageSize, "indexed section limit");
      const allowed = normalizePermissionScope(input.permissionScope);
      const terms = normalizeSearchTerms(input.terms);
      const scoreThreshold = normalizeScoreThreshold(input.scoreThreshold);
      const snapshot = await loadSnapshot(input);
      if (terms.length === 0) {
        return {
          ...(scoreThreshold === undefined ? {} : { filteredCount: 0 }),
          items: [],
          tokenizerVersion: PageIndexTokenizerVersion,
          truncated: false,
        };
      }

      const scored: PublishedPageIndexSectionSearchItem[] = [];
      const outlineMembers = snapshot.publicationMembers
        .filter(
          (member) =>
            member.componentType === "document-outline" && member.documentAssetId !== undefined,
        )
        .sort((left, right) => left.componentKey.localeCompare(right.componentKey));

      for (const member of outlineMembers) {
        let outline: DocumentOutline;
        try {
          outline = await requireReadableOutline({
            ...snapshot,
            allowed,
            documentAssetId: member.documentAssetId as string,
            generationId: member.generationId,
            outlineId: member.componentKey,
          });
        } catch (error) {
          if (error instanceof PublishedPageIndexOutlineNotFoundError) {
            continue;
          }
          throw error;
        }
        visitOutlineNodes(outline.nodes, (node, visitedNodeIds) => {
          if (!hasOpenableOutlineNodeRange(node)) {
            return;
          }
          const score = scorePageIndexOutlineNode(node, terms).score;
          if (score <= 0) {
            return;
          }
          scored.push({
            documentAssetId: outline.documentAssetId,
            documentVersion: outline.version,
            generationId: member.generationId,
            node: cloneOutlineNode(node),
            outlineId: outline.id,
            outlineVersion: outline.outlineVersion,
            score,
            visitedNodeIds: [...visitedNodeIds],
          });
        });
      }

      scored.sort(comparePublishedPageIndexSections);
      const thresholded =
        scoreThreshold === undefined
          ? scored
          : scored.filter((candidate) => candidate.score >= scoreThreshold);
      return {
        ...(scoreThreshold === undefined
          ? {}
          : { filteredCount: scored.length - thresholded.length }),
        items: thresholded.slice(0, input.limit),
        tokenizerVersion: PageIndexTokenizerVersion,
        truncated: thresholded.length > input.limit,
      };
    },
    listOutlines: async (input) => {
      validateLimit(input.limit, maxOutlinePageSize, "outline page size");
      const allowed = normalizePermissionScope(input.permissionScope);
      const snapshot = await loadSnapshot(input);
      const cursor = input.cursor ? normalizeUuid(input.cursor.componentKey) : undefined;
      const candidates = snapshot.publicationMembers
        .filter((member) => member.componentType === "document-outline")
        .filter((member) => member.documentAssetId !== undefined)
        .filter((member) => cursor === undefined || member.componentKey > cursor)
        .sort((left, right) => left.componentKey.localeCompare(right.componentKey));
      const readable: PublishedPageIndexOutlineItem[] = [];
      let filteredCount = 0;

      for (const member of candidates) {
        try {
          const outline = await requireReadableOutline({
            ...snapshot,
            allowed,
            documentAssetId: member.documentAssetId as string,
            generationId: member.generationId,
            outlineId: member.componentKey,
          });
          readable.push({
            documentAssetId: member.documentAssetId as string,
            generationId: member.generationId,
            outline,
            publicationId: snapshot.normalized.publicationId,
          });
        } catch (error) {
          if (!(error instanceof PublishedPageIndexOutlineNotFoundError)) {
            throw error;
          }
          filteredCount += 1;
        }
      }

      const page = readable.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit);
      const last = items.at(-1);

      return {
        filteredCount,
        items,
        ...(page.length > input.limit && last
          ? { nextCursor: { componentKey: last.outline.id } }
          : {}),
      };
    },
    openLeafEvidence: async (input) => {
      validateLimit(input.limit, maxLeafLimit, "leaf limit");
      const allowed = normalizePermissionScope(input.permissionScope);
      const documentAssetId = normalizeUuid(input.documentAssetId);
      const generationId = PublicationGenerationIdSchema.parse(input.generationId);
      const outlineId = normalizeUuid(input.outlineId);
      const outlineNodeId = normalizeNonEmpty(input.outlineNodeId, "outlineNodeId");
      const snapshot = await loadSnapshot(input);
      const outline = await requireReadableOutline({
        ...snapshot,
        allowed,
        documentAssetId,
        generationId,
        outlineId,
      });
      const selectedNode = findOutlineNode(outline.nodes, outlineNodeId);

      if (!selectedNode) {
        throw new PublishedPageIndexNodeNotFoundError(outlineNodeId);
      }

      const range = outlineNodeRange(selectedNode);
      const grouped = new Map<
        string,
        { readonly node: KnowledgeNode; readonly projections: IndexProjection[] }
      >();

      for (const member of snapshot.projectionMembers) {
        const readable = await loadReadableNode({
          allowed,
          documentAssetId,
          generationId,
          member,
          normalized: snapshot.normalized,
          projectionsById: snapshot.projectionsById,
        });

        if (
          !readable ||
          readable.node.parseArtifactId !== outline.parseArtifactId ||
          readable.node.artifactHash !== outline.artifactHash ||
          !halfOpenRangesOverlap(
            readable.node.startOffset,
            readable.node.endOffset,
            range.startOffset,
            range.endOffset,
          )
        ) {
          continue;
        }

        const existing = grouped.get(readable.node.id);
        if (existing) {
          if (
            !existing.projections.some((projection) => projection.id === readable.projection.id)
          ) {
            existing.projections.push(cloneIndexProjection(readable.projection));
          }
        } else {
          grouped.set(readable.node.id, {
            node: cloneNode(readable.node),
            projections: [cloneIndexProjection(readable.projection)],
          });
        }
      }

      const ordered = [...grouped.values()].sort(
        (left, right) =>
          left.node.startOffset - right.node.startOffset ||
          left.node.id.localeCompare(right.node.id),
      );
      const selected = ordered.slice(0, input.limit);

      return {
        items: selected.map(({ node, projections }) =>
          leafEvidence({ node, outline, outlineNodeId, projections }),
        ),
        openedRange: range,
        outline: cloneOutline(outline),
        selectedNode: cloneOutlineNode(selectedNode),
        truncated: ordered.length > input.limit,
      };
    },
  };
}

export function createDatabasePublishedPageIndexRepository({
  database,
  maxLeafLimit,
  maxOutlinePageSize,
  maxProjectionRows,
  maxSectionCandidateNodes = Math.min(20_000, maxOutlinePageSize * PageIndexMaxQueryTerms),
}: DatabasePublishedPageIndexRepositoryOptions): PublishedPageIndexRepository {
  validateBounds({ maxLeafLimit, maxOutlinePageSize, maxProjectionRows });
  validatePositiveBound(maxSectionCandidateNodes, "maxSectionCandidateNodes");

  return {
    searchSections: (input) =>
      databaseSearchPublishedPageIndexSections({
        database,
        input,
        maxCandidateNodes: maxSectionCandidateNodes,
        maxSectionLimit: maxOutlinePageSize,
      }),
    listOutlines: async (input) => {
      validateLimit(input.limit, maxOutlinePageSize, "outline page size");
      const scope = normalizeScope(input);
      const allowed = normalizePermissionScope(input.permissionScope);
      await databaseRequirePublishedSnapshot(database, scope);
      const cursor = input.cursor ? normalizeUuid(input.cursor.componentKey) : undefined;
      const params: DatabaseQueryValue[] = [
        scope.tenantId,
        scope.knowledgeSpaceId,
        scope.publicationId,
        scope.fingerprint,
        JSON.stringify([...allowed]),
      ];
      const cursorSql = cursor
        ? (() => {
            params.push(cursor);
            return ` AND om.${quoted(database, "component_key")} > ${databasePlaceholder(
              database,
              params.length,
            )}`;
          })()
        : "";
      const readLimit = input.limit + 1;
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `${publishedOutlineSelectSql(database)}${publishedOutlineFromSql(
          database,
        )}${publishedOutlineWhereSql(database, 5)}${cursorSql} ORDER BY om.${quoted(
          database,
          "component_key",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName: "projection_set_publication_members",
      });
      const page = result.rows.map((row) => mapPublishedOutlineRow(row, scope.publicationId));
      const items = page.slice(0, input.limit);
      const last = items.at(-1);

      return {
        items,
        ...(page.length > input.limit && last
          ? { nextCursor: { componentKey: last.outline.id } }
          : {}),
      };
    },
    openLeafEvidence: async (input) => {
      validateLimit(input.limit, maxLeafLimit, "leaf limit");
      const scope = normalizeScope(input);
      const allowed = normalizePermissionScope(input.permissionScope);
      await databaseRequirePublishedSnapshot(database, scope);
      const outlineId = normalizeUuid(input.outlineId);
      const outlineNodeId = normalizeNonEmpty(input.outlineNodeId, "outlineNodeId");
      const documentAssetId = normalizeUuid(input.documentAssetId);
      const generationId = PublicationGenerationIdSchema.parse(input.generationId);
      const outline = await databaseGetReadablePublishedOutline({
        allowed,
        database,
        documentAssetId,
        generationId,
        outlineId,
        scope,
      });

      if (!outline) {
        throw new PublishedPageIndexOutlineNotFoundError();
      }

      const selectedNode = findOutlineNode(outline.nodes, outlineNodeId);
      if (!selectedNode) {
        throw new PublishedPageIndexNodeNotFoundError(outlineNodeId);
      }
      const range = outlineNodeRange(selectedNode);
      const readLimit = input.limit + 1;
      const nodeParams: DatabaseQueryValue[] = [
        scope.knowledgeSpaceId,
        documentAssetId,
        generationId,
        outline.parseArtifactId,
        outline.artifactHash,
        range.endOffset,
        range.startOffset,
        JSON.stringify([...allowed]),
        scope.tenantId,
        scope.publicationId,
        scope.fingerprint,
        readLimit,
      ];
      const nodeResult = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params: nodeParams,
        sql: publishedLeafNodeSql(database, nodeParams.length),
        tableName: "knowledge_nodes",
      });
      const page = nodeResult.rows.map(mapPublishedKnowledgeNodeRow);
      const selectedNodes = page.slice(0, input.limit);
      const projections = await databaseGetPublishedProjectionsForNodes({
        database,
        documentAssetId,
        generationId,
        maxProjectionRows,
        nodeIds: selectedNodes.map((node) => node.id),
        scope,
      });
      const projectionsByNode = new Map<string, PublishedPageIndexProjectionReference[]>();
      for (const projection of projections) {
        const items = projectionsByNode.get(projection.nodeId) ?? [];
        items.push(projection);
        projectionsByNode.set(projection.nodeId, items);
      }

      return {
        items: selectedNodes
          .map((node) => ({ node, projections: projectionsByNode.get(node.id) ?? [] }))
          .filter((item) => item.projections.length > 0)
          .map(({ node, projections: nodeProjections }) =>
            leafEvidence({
              node,
              outline,
              outlineNodeId,
              projections: nodeProjections,
            }),
          ),
        openedRange: range,
        outline: cloneOutline(outline),
        selectedNode: cloneOutlineNode(selectedNode),
        truncated: page.length > input.limit,
      };
    },
  };
}

interface NormalizedPublishedPageIndexScope {
  readonly fingerprint: string;
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly tenantId: string;
}

type PublishedPageIndexProjectionReference = Pick<IndexProjection, "id" | "nodeId" | "type">;

function normalizeScope(scope: PublishedPageIndexScope): NormalizedPublishedPageIndexScope {
  return {
    fingerprint: ProjectionSetFingerprintSchema.parse(scope.fingerprint),
    knowledgeSpaceId: normalizeUuid(scope.knowledgeSpaceId),
    publicationId: normalizeUuid(scope.publicationId),
    tenantId: TenantIdSchema.parse(scope.tenantId),
  };
}

function validateBounds({
  maxLeafLimit,
  maxOutlinePageSize,
  maxProjectionRows,
}: {
  readonly maxLeafLimit: number;
  readonly maxOutlinePageSize: number;
  readonly maxProjectionRows: number;
}): void {
  validatePositiveBound(maxLeafLimit, "maxLeafLimit");
  validatePositiveBound(maxOutlinePageSize, "maxOutlinePageSize");
  validatePositiveBound(maxProjectionRows, "maxProjectionRows");
}

function validatePositiveBound(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Published PageIndex ${name} must be at least 1`);
  }
}

function validateLimit(value: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Published PageIndex ${name} must be at least 1`);
  }
  if (value > maximum) {
    throw new Error(`Published PageIndex ${name} exceeds maximum=${maximum}`);
  }
}

function normalizePermissionScope(permissionScope: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(permissionScope)) {
    throw new Error("Published PageIndex permissionScope is required");
  }

  const normalized = permissionScope.map((scope) => normalizeNonEmpty(scope, "permissionScope"));
  return new Set([...new Set(normalized)].sort());
}

function normalizeSearchTerms(terms: readonly string[]): readonly string[] {
  if (!Array.isArray(terms)) {
    throw new Error("Published PageIndex search terms are required");
  }
  if (terms.length > PageIndexMaxQueryTerms) {
    throw new Error(`Published PageIndex search terms exceed maximum=${PageIndexMaxQueryTerms}`);
  }
  const normalized = terms.map((term) => normalizeNonEmpty(term, "search term"));
  for (const term of normalized) {
    if (Array.from(term).length > PageIndexMaxTermChars) {
      throw new Error(
        `Published PageIndex search term exceeds maximum characters=${PageIndexMaxTermChars}`,
      );
    }
    if (new TextEncoder().encode(term).byteLength > PageIndexMaxTermBytes) {
      throw new Error(
        `Published PageIndex search term exceeds maximum bytes=${PageIndexMaxTermBytes}`,
      );
    }
  }
  return [...new Set(normalized)].sort();
}

function normalizeScoreThreshold(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Published PageIndex scoreThreshold must be between 0 and 1");
  }
  return value;
}

function canReadNode(node: KnowledgeNode, allowed: ReadonlySet<string>): boolean {
  return node.permissionScope.every((required) => allowed.has(required));
}

function normalizeUuid(value: string): string {
  return UuidSchema.parse(value);
}

function normalizeNonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Published PageIndex ${name} is required`);
  }
  return value.trim();
}

function findOutlineNode(
  nodes: readonly DocumentOutlineNode[],
  nodeId: string,
): DocumentOutlineNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const child = findOutlineNode(node.children, nodeId);
    if (child) {
      return child;
    }
  }
  return null;
}

function visitOutlineNodes(
  nodes: readonly DocumentOutlineNode[],
  visit: (node: DocumentOutlineNode, visitedNodeIds: readonly string[]) => void,
  ancestors: readonly string[] = [],
): void {
  for (const node of nodes) {
    const visitedNodeIds = [...ancestors, node.id];
    visit(node, visitedNodeIds);
    visitOutlineNodes(node.children, visit, visitedNodeIds);
  }
}

function hasOpenableOutlineNodeRange(node: DocumentOutlineNode): boolean {
  return (
    node.startOffset !== undefined &&
    node.endOffset !== undefined &&
    node.endOffset > node.startOffset
  );
}

function outlineNodeRange(node: DocumentOutlineNode): {
  readonly endOffset: number;
  readonly startOffset: number;
} {
  if (
    node.startOffset === undefined ||
    node.endOffset === undefined ||
    node.endOffset <= node.startOffset
  ) {
    throw new PublishedPageIndexRangeUnavailableError(node.id);
  }

  return { endOffset: node.endOffset, startOffset: node.startOffset };
}

function halfOpenRangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

function leafEvidence({
  node,
  outline,
  outlineNodeId,
  projections,
}: {
  readonly node: KnowledgeNode;
  readonly outline: DocumentOutline;
  readonly outlineNodeId: string;
  readonly projections: readonly (IndexProjection | PublishedPageIndexProjectionReference)[];
}): PublishedPageIndexLeafEvidence {
  const source = node.sourceLocation;

  return {
    citation: {
      artifactHash: node.artifactHash,
      documentAssetId: node.documentAssetId,
      documentVersion: outline.version,
      endOffset: source.endOffset ?? node.endOffset,
      ...(source.pageNumber === undefined ? {} : { pageNumber: source.pageNumber }),
      sectionPath: [...source.sectionPath],
      startOffset: source.startOffset ?? node.startOffset,
    },
    node: cloneNode(node),
    outlineId: outline.id,
    outlineNodeId,
    projections: projections.map((projection) => ({
      id: projection.id,
      type: projection.type,
    })),
  };
}

function cloneOutline(outline: DocumentOutline): DocumentOutline {
  return DocumentOutlineSchema.parse(JSON.parse(JSON.stringify(outline)) as unknown);
}

function cloneOutlineNode(node: DocumentOutlineNode): DocumentOutlineNode {
  return JSON.parse(JSON.stringify(node)) as DocumentOutlineNode;
}

function cloneNode(node: KnowledgeNode): KnowledgeNode {
  return KnowledgeNodeSchema.parse(JSON.parse(JSON.stringify(node)) as unknown);
}

function quoted(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

async function databaseSearchPublishedPageIndexSections({
  database,
  input,
  maxCandidateNodes,
  maxSectionLimit,
}: {
  readonly database: DatabaseAdapter;
  readonly input: SearchPublishedPageIndexSectionsInput;
  readonly maxCandidateNodes: number;
  readonly maxSectionLimit: number;
}): Promise<SearchPublishedPageIndexSectionsResult> {
  validateLimit(input.limit, maxSectionLimit, "indexed section limit");
  const scope = normalizeScope(input);
  const allowed = normalizePermissionScope(input.permissionScope);
  const terms = normalizeSearchTerms(input.terms);
  const scoreThreshold = normalizeScoreThreshold(input.scoreThreshold);
  await databaseRequirePublishedSnapshot(database, scope);
  if (terms.length === 0) {
    return {
      ...(scoreThreshold === undefined ? {} : { filteredCount: 0 }),
      items: [],
      tokenizerVersion: PageIndexTokenizerVersion,
      truncated: false,
    };
  }

  // Parameter order follows SQL appearance so the same statement is executable with TiDB's
  // anonymous `?` placeholders as well as PostgreSQL's numbered placeholders.
  const params: DatabaseQueryValue[] = [scope.knowledgeSpaceId, ...terms];
  const termStartPosition = 2;
  const termSql = terms
    .map((_, index) => databasePlaceholder(database, termStartPosition + index))
    .join(", ");
  // The requested immutable publication is applied inside the posting aggregation so retained
  // manifests from older/newer generations cannot participate in scoring work. The same scope is
  // repeated for the outer closure because TiDB's anonymous placeholders cannot be reused.
  params.push(scope.tenantId, scope.knowledgeSpaceId, scope.publicationId, scope.fingerprint);
  const postingScopeParameterPositions: PublishedPublicationScopeParameterPositions = {
    fingerprint: terms.length + 5,
    knowledgeSpaceId: terms.length + 3,
    publicationId: terms.length + 4,
    tenantId: terms.length + 2,
  };
  params.push(
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.publicationId,
    scope.fingerprint,
    JSON.stringify([...allowed]),
  );
  const scopeParameterPositions: PublishedOutlineScopeParameterPositions = {
    fingerprint: terms.length + 9,
    knowledgeSpaceId: terms.length + 7,
    permissionScope: terms.length + 10,
    publicationId: terms.length + 8,
    tenantId: terms.length + 6,
  };
  const candidateReadLimit = maxCandidateNodes + 1;
  params.push(candidateReadLimit);
  const result = await database.execute({
    maxRows: candidateReadLimit,
    operation: "select",
    params,
    sql: pageIndexScoredNodeCandidateSql(
      database,
      termSql,
      terms.length,
      postingScopeParameterPositions,
      scopeParameterPositions,
      databasePlaceholder(database, params.length),
    ),
    tableName: "page_index_terms",
  });
  const candidateWindowTruncated = result.rows.length > maxCandidateNodes;
  const scored = result.rows
    .slice(0, maxCandidateNodes)
    .map(mapPageIndexScoredNodeRow)
    .sort(comparePublishedPageIndexSections);
  const thresholded =
    scoreThreshold === undefined
      ? scored
      : scored.filter((candidate) => candidate.score >= scoreThreshold);

  return {
    ...(scoreThreshold === undefined ? {} : { filteredCount: scored.length - thresholded.length }),
    items: thresholded.slice(0, input.limit),
    tokenizerVersion: PageIndexTokenizerVersion,
    truncated: candidateWindowTruncated || thresholded.length > input.limit,
  };
}

/**
 * Starts at the exact `(knowledge_space_id, term, ...)` posting index. Matching postings are
 * restricted to the exact immutable publication/member/ready-manifest closure, then grouped into
 * section nodes and scored before the candidate-node bound is applied. The outer joins prove the
 * remaining node/outline/asset/generation closure and complete-outline caller readability.
 */
function pageIndexScoredNodeCandidateSql(
  database: DatabaseAdapter,
  termSql: string,
  termCount: number,
  postingScopeParameterPositions: PublishedPublicationScopeParameterPositions,
  scopeParameterPositions: PublishedOutlineScopeParameterPositions,
  limitSql: string,
): string {
  const matchedAlias = "matched";
  const scoreSql = pageIndexNormalizedScoreSql(database, matchedAlias, termCount);
  return `SELECT ${pageIndexScoredNodeSelectSql(database, scoreSql)} FROM (SELECT ${column(
    database,
    "pit",
    "knowledge_space_id",
  )} AS ${quoted(database, "knowledge_space_id")}, ${column(
    database,
    "pit",
    "manifest_id",
  )} AS ${quoted(database, "manifest_id")}, ${column(
    database,
    "pit",
    "page_index_node_id",
  )} AS ${quoted(database, "page_index_node_id")}, ${pageIndexFieldMatchCountSql(
    database,
    1,
  )} AS ${quoted(database, "title_matches")}, ${pageIndexFieldMatchCountSql(
    database,
    2,
  )} AS ${quoted(database, "summary_matches")}, ${pageIndexFieldMatchCountSql(
    database,
    4,
  )} AS ${quoted(database, "section_matches")} FROM ${quoted(
    database,
    "page_index_terms",
  )} pit JOIN ${quoted(database, "page_index_manifests")} scoped_pim ON ${column(
    database,
    "scoped_pim",
    "id",
  )} = ${column(database, "pit", "manifest_id")} AND ${column(
    database,
    "scoped_pim",
    "knowledge_space_id",
  )} = ${column(database, "pit", "knowledge_space_id")} JOIN ${quoted(
    database,
    "projection_set_publication_members",
  )} scoped_om ON ${column(database, "scoped_om", "knowledge_space_id")} = ${column(
    database,
    "scoped_pim",
    "knowledge_space_id",
  )} AND ${column(database, "scoped_om", "component_type")} = 'document-outline' AND ${column(
    database,
    "scoped_om",
    "component_key",
  )} = ${column(database, "scoped_pim", "document_outline_id")} AND ${column(
    database,
    "scoped_om",
    "generation_id",
  )} = ${column(database, "scoped_pim", "publication_generation_id")} AND ${column(
    database,
    "scoped_om",
    "document_asset_id",
  )} = ${column(database, "scoped_pim", "document_asset_id")} JOIN ${quoted(
    database,
    "projection_set_publications",
  )} scoped_pub ON ${column(database, "scoped_pub", "tenant_id")} = ${column(
    database,
    "scoped_om",
    "tenant_id",
  )} AND ${column(database, "scoped_pub", "knowledge_space_id")} = ${column(
    database,
    "scoped_om",
    "knowledge_space_id",
  )} AND ${column(database, "scoped_pub", "id")} = ${column(
    database,
    "scoped_om",
    "publication_id",
  )} WHERE ${column(database, "pit", "knowledge_space_id")} = ${databasePlaceholder(
    database,
    1,
  )} AND ${column(database, "pit", "term")} IN (${termSql}) AND ${column(
    database,
    "scoped_pub",
    "tenant_id",
  )} = ${databasePlaceholder(database, postingScopeParameterPositions.tenantId)} AND ${column(
    database,
    "scoped_pub",
    "knowledge_space_id",
  )} = ${databasePlaceholder(
    database,
    postingScopeParameterPositions.knowledgeSpaceId,
  )} AND ${column(database, "scoped_pub", "id")} = ${databasePlaceholder(
    database,
    postingScopeParameterPositions.publicationId,
  )} AND ${column(database, "scoped_pub", "fingerprint")} = ${databasePlaceholder(
    database,
    postingScopeParameterPositions.fingerprint,
  )} AND ${column(database, "scoped_pub", "status")} IN ('published', 'superseded') AND ${column(
    database,
    "scoped_pim",
    "status",
  )} = 'ready' AND ${column(
    database,
    "scoped_pim",
    "tokenizer_version",
  )} = '${PageIndexTokenizerVersion}' AND CHAR_LENGTH(${column(
    database,
    "scoped_pim",
    "checksum",
  )}) = 64 AND ${column(database, "scoped_pim", "node_count")} > 0 AND ${column(
    database,
    "scoped_pim",
    "term_count",
  )} > 0 GROUP BY ${column(database, "pit", "knowledge_space_id")}, ${column(
    database,
    "pit",
    "manifest_id",
  )}, ${column(database, "pit", "page_index_node_id")}) ${matchedAlias} JOIN ${quoted(
    database,
    "page_index_nodes",
  )} pin ON ${column(database, "pin", "manifest_id")} = ${column(
    database,
    matchedAlias,
    "manifest_id",
  )} AND ${column(database, "pin", "id")} = ${column(
    database,
    matchedAlias,
    "page_index_node_id",
  )} JOIN ${quoted(database, "page_index_manifests")} pim ON ${column(
    database,
    "pim",
    "id",
  )} = ${column(database, matchedAlias, "manifest_id")} AND ${column(
    database,
    "pim",
    "knowledge_space_id",
  )} = ${column(database, matchedAlias, "knowledge_space_id")} JOIN ${quoted(
    database,
    "document_outlines",
  )} o ON ${column(database, "o", "id")} = ${column(
    database,
    "pim",
    "document_outline_id",
  )} AND ${column(database, "o", "knowledge_space_id")} = ${column(
    database,
    "pim",
    "knowledge_space_id",
  )} AND ${column(database, "o", "publication_generation_id")} = ${column(
    database,
    "pim",
    "publication_generation_id",
  )} AND ${column(database, "o", "document_asset_id")} = ${column(
    database,
    "pim",
    "document_asset_id",
  )} AND ${column(database, "o", "version")} = ${column(
    database,
    "pim",
    "document_version",
  )} JOIN ${quoted(database, "document_assets")} da ON ${column(
    database,
    "da",
    "id",
  )} = ${column(database, "o", "document_asset_id")} AND ${column(
    database,
    "da",
    "knowledge_space_id",
  )} = ${column(database, "o", "knowledge_space_id")} AND ${column(
    database,
    "da",
    "version",
  )} = ${column(database, "o", "version")} JOIN ${quoted(
    database,
    "projection_set_publication_members",
  )} om ON ${column(database, "om", "knowledge_space_id")} = ${column(
    database,
    "pim",
    "knowledge_space_id",
  )} AND ${column(database, "om", "component_type")} = 'document-outline' AND ${column(
    database,
    "om",
    "component_key",
  )} = ${column(database, "pim", "document_outline_id")} AND ${column(
    database,
    "om",
    "generation_id",
  )} = ${column(database, "pim", "publication_generation_id")} AND ${column(
    database,
    "om",
    "document_asset_id",
  )} = ${column(database, "pim", "document_asset_id")} JOIN ${quoted(
    database,
    "projection_set_publications",
  )} pub ON ${column(database, "pub", "tenant_id")} = ${column(
    database,
    "om",
    "tenant_id",
  )} AND ${column(database, "pub", "knowledge_space_id")} = ${column(
    database,
    "om",
    "knowledge_space_id",
  )} AND ${column(database, "pub", "id")} = ${column(
    database,
    "om",
    "publication_id",
  )}${publishedOutlineWhereSql(
    database,
    scopeParameterPositions.permissionScope,
    scopeParameterPositions,
  )} AND ${column(
    database,
    "pim",
    "status",
  )} = 'ready' AND ${column(database, "pim", "tokenizer_version")} = '${PageIndexTokenizerVersion}' AND CHAR_LENGTH(${column(
    database,
    "pim",
    "checksum",
  )}) = 64 AND ${column(database, "pim", "node_count")} > 0 AND ${column(
    database,
    "pim",
    "term_count",
  )} > 0 AND ${column(database, "pin", "start_offset")} IS NOT NULL AND ${column(
    database,
    "pin",
    "end_offset",
  )} > ${column(database, "pin", "start_offset")} ORDER BY ${quoted(
    database,
    "score",
  )} DESC, ${column(database, "pin", "level")} DESC, ${column(
    database,
    "o",
    "id",
  )} ASC, ${column(database, "pin", "outline_node_id")} ASC LIMIT ${limitSql};`;
}

function pageIndexFieldMatchCountSql(database: DatabaseAdapter, fieldBit: 1 | 2 | 4): string {
  return `COUNT(DISTINCT CASE WHEN (${column(database, "pit", "field_mask")} & ${fieldBit}) <> 0 THEN ${column(
    database,
    "pit",
    "term",
  )} ELSE NULL END)`;
}

function pageIndexNormalizedScoreSql(
  database: DatabaseAdapter,
  matchedAlias: string,
  termCount: number,
): string {
  const numericType = database.dialect === "postgres" ? "DOUBLE PRECISION" : "DOUBLE";
  const ratio = (columnName: string, weight: number) =>
    `${weight} * CAST(${column(database, matchedAlias, columnName)} AS ${numericType}) / ${termCount}`;
  return `LEAST(1.0, GREATEST(${ratio("title_matches", 1)}, ${ratio(
    "summary_matches",
    0.9,
  )}, ${ratio("section_matches", 0.8)}))`;
}

function pageIndexScoredNodeSelectSql(database: DatabaseAdapter, scoreSql: string): string {
  const columns: readonly [string, string, string][] = [
    ["pim", "id", "manifest_id"],
    ["pim", "document_asset_id", "document_asset_id"],
    ["pim", "publication_generation_id", "generation_id"],
    ["pim", "document_outline_id", "outline_id"],
    ["pim", "document_version", "document_version"],
    ["o", "outline_version", "outline_version"],
    ["pin", "outline_node_id", "outline_node_id"],
    ["pin", "title", "title"],
    ["pin", "summary", "summary"],
    ["pin", "section_path", "section_path"],
    ["pin", "visited_node_ids", "visited_node_ids"],
    ["pin", "level", "level"],
    ["pin", "start_offset", "start_offset"],
    ["pin", "end_offset", "end_offset"],
    ["pin", "toc_source", "toc_source"],
  ];
  return `${columns
    .map(
      ([alias, name, output]) => `${column(database, alias, name)} AS ${quoted(database, output)}`,
    )
    .join(", ")}, ${scoreSql} AS ${quoted(database, "score")}`;
}

async function databaseRequirePublishedSnapshot(
  database: DatabaseAdapter,
  scope: NormalizedPublishedPageIndexScope,
): Promise<void> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.publicationId, scope.fingerprint],
    sql: `SELECT 1 AS ${quoted(database, "snapshot_exists")} FROM ${quoted(
      database,
      "projection_set_publications",
    )} pub WHERE ${column(
      database,
      "pub",
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${column(
      database,
      "pub",
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${column(
      database,
      "pub",
      "id",
    )} = ${databasePlaceholder(database, 3)} AND ${column(
      database,
      "pub",
      "fingerprint",
    )} = ${databasePlaceholder(database, 4)} AND ${column(
      database,
      "pub",
      "status",
    )} IN ('published', 'superseded') LIMIT 1;`,
    tableName: "projection_set_publications",
  });

  if (!result.rows[0]) {
    throw new PublishedPageIndexSnapshotNotFoundError();
  }
}

function mapPageIndexScoredNodeRow(row: DatabaseRow): PublishedPageIndexSectionSearchItem {
  const startOffset = optionalNumberColumn(row, "start_offset");
  const endOffset = optionalNumberColumn(row, "end_offset");
  const summary = optionalStringColumn(row, "summary");
  const score = numberColumn(row, "score");
  normalizeUuid(stringColumn(row, "manifest_id"));
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("Published PageIndex scored node score must be between 0 and 1");
  }
  const node: DocumentOutlineNode = {
    childNodeIds: [],
    children: [],
    ...(endOffset !== undefined ? { endOffset } : {}),
    id: normalizeNonEmpty(stringColumn(row, "outline_node_id"), "outlineNodeId"),
    level: numberColumn(row, "level"),
    metadata: {},
    sectionPath: jsonStringArrayColumn(row, "section_path"),
    sourceElementIds: [],
    sourceNodeIds: [],
    ...(startOffset !== undefined ? { startOffset } : {}),
    ...(summary ? { summary } : {}),
    title: stringColumn(row, "title"),
    tocSource: DocumentOutlineTocSourceSchema.parse(stringColumn(row, "toc_source")),
  };
  return {
    documentAssetId: normalizeUuid(stringColumn(row, "document_asset_id")),
    documentVersion: numberColumn(row, "document_version"),
    generationId: PublicationGenerationIdSchema.parse(stringColumn(row, "generation_id")),
    node,
    outlineId: normalizeUuid(stringColumn(row, "outline_id")),
    outlineVersion: normalizeNonEmpty(stringColumn(row, "outline_version"), "outlineVersion"),
    score,
    visitedNodeIds: jsonStringArrayColumn(row, "visited_node_ids"),
  };
}

function comparePublishedPageIndexSections(
  left: PublishedPageIndexSectionSearchItem,
  right: PublishedPageIndexSectionSearchItem,
): number {
  return (
    right.score - left.score ||
    right.node.level - left.node.level ||
    left.outlineId.localeCompare(right.outlineId) ||
    left.node.id.localeCompare(right.node.id)
  );
}

function column(database: DatabaseAdapter, alias: string, identifier: string): string {
  return `${alias}.${quoted(database, identifier)}`;
}

function publishedOutlineSelectSql(database: DatabaseAdapter): string {
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

  return `SELECT ${columns
    .map((name) => `${column(database, "o", name)} AS ${quoted(database, `outline_${name}`)}`)
    .join(", ")}`;
}

function publishedOutlineFromSql(database: DatabaseAdapter): string {
  return ` FROM ${quoted(database, "projection_set_publications")} pub JOIN ${quoted(
    database,
    "projection_set_publication_members",
  )} om ON ${column(
    database,
    "om",
    "tenant_id",
  )} = ${column(database, "pub", "tenant_id")} AND ${column(
    database,
    "om",
    "knowledge_space_id",
  )} = ${column(database, "pub", "knowledge_space_id")} AND ${column(
    database,
    "om",
    "publication_id",
  )} = ${column(database, "pub", "id")} JOIN ${quoted(
    database,
    "document_outlines",
  )} o ON ${column(database, "o", "id")} = ${column(
    database,
    "om",
    "component_key",
  )} AND ${column(database, "o", "knowledge_space_id")} = ${column(
    database,
    "om",
    "knowledge_space_id",
  )} AND ${column(database, "o", "publication_generation_id")} = ${column(
    database,
    "om",
    "generation_id",
  )} AND ${column(database, "o", "document_asset_id")} = ${column(
    database,
    "om",
    "document_asset_id",
  )} JOIN ${quoted(database, "document_assets")} da ON ${column(
    database,
    "da",
    "id",
  )} = ${column(database, "o", "document_asset_id")} AND ${column(
    database,
    "da",
    "knowledge_space_id",
  )} = ${column(database, "o", "knowledge_space_id")}`;
}

interface PublishedPublicationScopeParameterPositions {
  readonly fingerprint: number;
  readonly knowledgeSpaceId: number;
  readonly publicationId: number;
  readonly tenantId: number;
}

interface PublishedOutlineScopeParameterPositions
  extends PublishedPublicationScopeParameterPositions {
  readonly permissionScope: number;
}

function publishedOutlineWhereSql(
  database: DatabaseAdapter,
  permissionParam: number,
  scopeParameterPositions: PublishedOutlineScopeParameterPositions = {
    fingerprint: 4,
    knowledgeSpaceId: 2,
    permissionScope: permissionParam,
    publicationId: 3,
    tenantId: 1,
  },
): string {
  const permissionPlaceholder = databasePlaceholder(database, permissionParam);
  const readablePredicate = publishedNodePermissionPredicate(
    database,
    permissionPlaceholder,
    "denied_n",
  );
  const eligibleNode = publishedOutlineEligibleNodeSubquery(database, {
    memberAlias: "pm",
    nodeAlias: "n",
    projectionAlias: "ip",
  });
  const unreadableNode = publishedOutlineEligibleNodeSubquery(database, {
    extraPredicate: `(${readablePredicate}) IS NOT TRUE`,
    memberAlias: "denied_pm",
    nodeAlias: "denied_n",
    projectionAlias: "denied_ip",
  });

  return ` WHERE ${column(database, "pub", "tenant_id")} = ${databasePlaceholder(
    database,
    scopeParameterPositions.tenantId,
  )} AND ${column(database, "pub", "knowledge_space_id")} = ${databasePlaceholder(
    database,
    scopeParameterPositions.knowledgeSpaceId,
  )} AND ${column(database, "pub", "id")} = ${databasePlaceholder(
    database,
    scopeParameterPositions.publicationId,
  )} AND ${column(database, "pub", "fingerprint")} = ${databasePlaceholder(
    database,
    scopeParameterPositions.fingerprint,
  )} AND ${column(database, "pub", "status")} IN ('published', 'superseded') AND ${column(
    database,
    "om",
    "component_type",
  )} = 'document-outline' AND ${column(
    database,
    "om",
    "document_asset_id",
  )} IS NOT NULL AND ${column(database, "da", "parser_status")} = 'parsed' AND ${column(
    database,
    "da",
    "lifecycle_state",
  )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
    database,
    "da",
    "outline_parent_source",
  )} AND EXISTS (${eligibleNode}) AND NOT EXISTS (${unreadableNode})`;
}

function publishedNodePermissionPredicate(
  database: DatabaseAdapter,
  permissionPlaceholder: string,
  nodeAlias: string,
): string {
  return database.dialect === "postgres"
    ? `${permissionPlaceholder}::jsonb @> ${column(database, nodeAlias, "permission_scope")}`
    : `JSON_CONTAINS(CAST(${permissionPlaceholder} AS JSON), ${column(
        database,
        nodeAlias,
        "permission_scope",
      )})`;
}

function publishedOutlineEligibleNodeSubquery(
  database: DatabaseAdapter,
  {
    extraPredicate,
    memberAlias,
    nodeAlias,
    projectionAlias,
  }: {
    readonly extraPredicate?: string | undefined;
    readonly memberAlias: string;
    readonly nodeAlias: string;
    readonly projectionAlias: string;
  },
): string {
  return `SELECT 1 FROM ${quoted(
    database,
    "projection_set_publication_members",
  )} ${memberAlias} JOIN ${quoted(database, "index_projections")} ${projectionAlias} ON ${column(
    database,
    projectionAlias,
    "id",
  )} = ${column(database, memberAlias, "component_key")} AND ${column(
    database,
    projectionAlias,
    "knowledge_space_id",
  )} = ${column(database, memberAlias, "knowledge_space_id")} AND ${column(
    database,
    projectionAlias,
    "publication_generation_id",
  )} = ${column(database, memberAlias, "generation_id")} JOIN ${quoted(
    database,
    "knowledge_nodes",
  )} ${nodeAlias} ON ${column(database, nodeAlias, "id")} = ${column(
    database,
    projectionAlias,
    "node_id",
  )} AND ${column(database, nodeAlias, "knowledge_space_id")} = ${column(
    database,
    memberAlias,
    "knowledge_space_id",
  )} AND ${column(database, nodeAlias, "publication_generation_id")} = ${column(
    database,
    memberAlias,
    "generation_id",
  )} AND ${column(database, nodeAlias, "document_asset_id")} = ${column(
    database,
    memberAlias,
    "document_asset_id",
  )} WHERE ${column(database, memberAlias, "tenant_id")} = ${column(
    database,
    "pub",
    "tenant_id",
  )} AND ${column(database, memberAlias, "knowledge_space_id")} = ${column(
    database,
    "pub",
    "knowledge_space_id",
  )} AND ${column(database, memberAlias, "publication_id")} = ${column(
    database,
    "pub",
    "id",
  )} AND ${column(database, memberAlias, "component_type")} = 'index-projection' AND ${column(
    database,
    memberAlias,
    "document_asset_id",
  )} = ${column(database, "om", "document_asset_id")} AND ${column(
    database,
    memberAlias,
    "generation_id",
  )} = ${column(database, "om", "generation_id")} AND ${column(
    database,
    projectionAlias,
    "status",
  )} = 'ready' AND ${column(database, nodeAlias, "kind")} <> 'summary' AND ${column(
    database,
    nodeAlias,
    "parse_artifact_id",
  )} = ${column(database, "o", "parse_artifact_id")} AND ${column(
    database,
    nodeAlias,
    "artifact_hash",
  )} = ${column(database, "o", "artifact_hash")}${extraPredicate ? ` AND ${extraPredicate}` : ""}`;
}

async function databaseGetReadablePublishedOutline({
  allowed,
  database,
  documentAssetId,
  generationId,
  outlineId,
  scope,
}: {
  readonly allowed: ReadonlySet<string>;
  readonly database: DatabaseAdapter;
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly outlineId: string;
  readonly scope: NormalizedPublishedPageIndexScope;
}): Promise<DocumentOutline | null> {
  const params: DatabaseQueryValue[] = [
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.publicationId,
    scope.fingerprint,
    JSON.stringify([...allowed]),
    outlineId,
    generationId,
    documentAssetId,
  ];
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `${publishedOutlineSelectSql(database)}${publishedOutlineFromSql(
      database,
    )}${publishedOutlineWhereSql(database, 5)} AND ${column(
      database,
      "om",
      "component_key",
    )} = ${databasePlaceholder(database, 6)} AND ${column(
      database,
      "om",
      "generation_id",
    )} = ${databasePlaceholder(database, 7)} AND ${column(
      database,
      "om",
      "document_asset_id",
    )} = ${databasePlaceholder(database, 8)} LIMIT 1;`,
    tableName: "projection_set_publication_members",
  });

  return result.rows[0]
    ? mapPublishedOutlineRow(result.rows[0], scope.publicationId).outline
    : null;
}

function publishedLeafNodeSql(database: DatabaseAdapter, limitParameter: number): string {
  const permissionPredicate =
    database.dialect === "postgres"
      ? `${databasePlaceholder(database, 8)}::jsonb @> ${column(database, "n", "permission_scope")}`
      : `JSON_CONTAINS(CAST(${databasePlaceholder(database, 8)} AS JSON), ${column(
          database,
          "n",
          "permission_scope",
        )})`;

  return `SELECT n.* FROM ${quoted(database, "knowledge_nodes")} n JOIN ${quoted(
    database,
    "document_assets",
  )} da ON ${column(database, "da", "id")} = ${column(
    database,
    "n",
    "document_asset_id",
  )} AND ${column(database, "da", "knowledge_space_id")} = ${column(
    database,
    "n",
    "knowledge_space_id",
  )} WHERE ${column(database, "n", "knowledge_space_id")} = ${databasePlaceholder(
    database,
    1,
  )} AND ${column(database, "n", "document_asset_id")} = ${databasePlaceholder(
    database,
    2,
  )} AND ${column(database, "n", "publication_generation_id")} = ${databasePlaceholder(
    database,
    3,
  )} AND ${column(database, "n", "parse_artifact_id")} = ${databasePlaceholder(
    database,
    4,
  )} AND ${column(database, "n", "artifact_hash")} = ${databasePlaceholder(
    database,
    5,
  )} AND ${column(database, "n", "kind")} <> 'summary' AND ${column(
    database,
    "n",
    "start_offset",
  )} < ${databasePlaceholder(database, 6)} AND ${column(
    database,
    "n",
    "end_offset",
  )} > ${databasePlaceholder(database, 7)} AND ${column(
    database,
    "da",
    "parser_status",
  )} = 'parsed' AND ${column(
    database,
    "da",
    "lifecycle_state",
  )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
    database,
    "da",
    "leaf_parent_source",
  )} AND ${permissionPredicate} AND EXISTS (SELECT 1 FROM ${quoted(
    database,
    "projection_set_publications",
  )} pub JOIN ${quoted(
    database,
    "projection_set_publication_members",
  )} pm ON ${column(database, "pm", "tenant_id")} = ${column(
    database,
    "pub",
    "tenant_id",
  )} AND ${column(database, "pm", "knowledge_space_id")} = ${column(
    database,
    "pub",
    "knowledge_space_id",
  )} AND ${column(database, "pm", "publication_id")} = ${column(
    database,
    "pub",
    "id",
  )} JOIN ${quoted(database, "index_projections")} ip ON ${column(
    database,
    "ip",
    "id",
  )} = ${column(database, "pm", "component_key")} AND ${column(
    database,
    "ip",
    "knowledge_space_id",
  )} = ${column(database, "pm", "knowledge_space_id")} AND ${column(
    database,
    "ip",
    "publication_generation_id",
  )} = ${column(database, "pm", "generation_id")} WHERE ${column(
    database,
    "pub",
    "tenant_id",
  )} = ${databasePlaceholder(database, 9)} AND ${column(
    database,
    "pub",
    "knowledge_space_id",
  )} = ${column(database, "n", "knowledge_space_id")} AND ${column(
    database,
    "pub",
    "id",
  )} = ${databasePlaceholder(database, 10)} AND ${column(
    database,
    "pub",
    "fingerprint",
  )} = ${databasePlaceholder(database, 11)} AND ${column(
    database,
    "pub",
    "status",
  )} IN ('published', 'superseded') AND ${column(
    database,
    "pm",
    "component_type",
  )} = 'index-projection' AND ${column(
    database,
    "pm",
    "document_asset_id",
  )} = ${column(database, "n", "document_asset_id")} AND ${column(
    database,
    "pm",
    "generation_id",
  )} = ${column(database, "n", "publication_generation_id")} AND ${column(
    database,
    "ip",
    "status",
  )} = 'ready' AND ${column(database, "ip", "node_id")} = ${column(
    database,
    "n",
    "id",
  )}) ORDER BY ${column(database, "n", "start_offset")} ASC, ${column(
    database,
    "n",
    "id",
  )} ASC LIMIT ${databasePlaceholder(database, limitParameter)};`;
}

async function databaseGetPublishedProjectionsForNodes({
  database,
  documentAssetId,
  generationId,
  maxProjectionRows,
  nodeIds,
  scope,
}: {
  readonly database: DatabaseAdapter;
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly maxProjectionRows: number;
  readonly nodeIds: readonly string[];
  readonly scope: NormalizedPublishedPageIndexScope;
}): Promise<PublishedPageIndexProjectionReference[]> {
  if (nodeIds.length === 0) {
    return [];
  }

  const params: DatabaseQueryValue[] = [
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.publicationId,
    scope.fingerprint,
    documentAssetId,
    generationId,
    ...nodeIds,
  ];
  const nodePlaceholders = nodeIds
    .map((_, index) => databasePlaceholder(database, index + 7))
    .join(", ");
  const readLimit = maxProjectionRows + 1;
  params.push(readLimit);
  const result = await database.execute({
    maxRows: readLimit,
    operation: "select",
    params,
    sql: `SELECT ${column(database, "ip", "id")} AS ${quoted(
      database,
      "id",
    )}, ${column(database, "ip", "node_id")} AS ${quoted(
      database,
      "node_id",
    )}, ${column(database, "ip", "type")} AS ${quoted(
      database,
      "type",
    )} FROM ${quoted(database, "projection_set_publications")} pub JOIN ${quoted(
      database,
      "projection_set_publication_members",
    )} pm ON ${column(database, "pm", "tenant_id")} = ${column(
      database,
      "pub",
      "tenant_id",
    )} AND ${column(database, "pm", "knowledge_space_id")} = ${column(
      database,
      "pub",
      "knowledge_space_id",
    )} AND ${column(database, "pm", "publication_id")} = ${column(
      database,
      "pub",
      "id",
    )} JOIN ${quoted(database, "index_projections")} ip ON ${column(
      database,
      "ip",
      "id",
    )} = ${column(database, "pm", "component_key")} AND ${column(
      database,
      "ip",
      "knowledge_space_id",
    )} = ${column(database, "pm", "knowledge_space_id")} AND ${column(
      database,
      "ip",
      "publication_generation_id",
    )} = ${column(database, "pm", "generation_id")} JOIN ${quoted(
      database,
      "document_assets",
    )} da ON ${column(database, "da", "id")} = ${column(
      database,
      "pm",
      "document_asset_id",
    )} AND ${column(database, "da", "knowledge_space_id")} = ${column(
      database,
      "pm",
      "knowledge_space_id",
    )} WHERE ${column(
      database,
      "pub",
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${column(
      database,
      "pub",
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${column(
      database,
      "pub",
      "id",
    )} = ${databasePlaceholder(database, 3)} AND ${column(
      database,
      "pub",
      "fingerprint",
    )} = ${databasePlaceholder(database, 4)} AND ${column(
      database,
      "pub",
      "status",
    )} IN ('published', 'superseded') AND ${column(
      database,
      "pm",
      "component_type",
    )} = 'index-projection' AND ${column(
      database,
      "pm",
      "document_asset_id",
    )} = ${databasePlaceholder(database, 5)} AND ${column(
      database,
      "pm",
      "generation_id",
    )} = ${databasePlaceholder(database, 6)} AND ${column(
      database,
      "ip",
      "status",
    )} = 'ready' AND ${column(
      database,
      "da",
      "lifecycle_state",
    )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
      database,
      "da",
      "projection_parent_source",
    )} AND ${column(
      database,
      "ip",
      "node_id",
    )} IN (${nodePlaceholders}) ORDER BY ${column(database, "ip", "node_id")} ASC, ${column(
      database,
      "ip",
      "id",
    )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
    tableName: "projection_set_publication_members",
  });

  if (result.rows.length > maxProjectionRows) {
    throw new PublishedPageIndexProjectionLimitExceededError(maxProjectionRows);
  }

  return result.rows.map((row) => ({
    id: normalizeUuid(stringColumn(row, "id")),
    nodeId: normalizeUuid(stringColumn(row, "node_id")),
    type: IndexProjectionSchema.shape.type.parse(stringColumn(row, "type")),
  }));
}

function mapPublishedOutlineRow(
  row: DatabaseRow,
  publicationId: string,
): PublishedPageIndexOutlineItem {
  const updatedAt = optionalStringColumn(row, "outline_updated_at");
  const outline = DocumentOutlineSchema.parse({
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

  return {
    documentAssetId: outline.documentAssetId,
    generationId: outline.publicationGenerationId as string,
    outline,
    publicationId,
  };
}

function mapPublishedKnowledgeNodeRow(row: DatabaseRow): KnowledgeNode {
  const updatedAt = optionalStringColumn(row, "updated_at");

  return KnowledgeNodeSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    endOffset: numberColumn(row, "end_offset"),
    id: stringColumn(row, "id"),
    kind: stringColumn(row, "kind"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: cloneJsonObject(jsonObjectColumn(row, "metadata")),
    parseArtifactId: stringColumn(row, "parse_artifact_id"),
    permissionScope: jsonStringArrayColumn(row, "permission_scope"),
    publicationGenerationId: stringColumn(row, "publication_generation_id"),
    sourceLocation: jsonObjectColumn(row, "source_location"),
    startOffset: numberColumn(row, "start_offset"),
    text: stringColumn(row, "text"),
    ...(updatedAt ? { updatedAt } : {}),
  });
}
