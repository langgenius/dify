import type { DatabaseAdapter, DatabaseQueryValue } from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";

import {
  databasePlaceholder,
  qualifiedDatabaseIdentifier,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { readableDocumentParentSourcePredicateSql } from "./document-asset-visibility-sql";
import { isPlainObject } from "./json-utils";
import type {
  FilterProjectionSetPublicationMemberKeysInput,
  ProjectionSetPublicationMemberRepository,
} from "./projection-publication-member-repository";
import {
  type HybridRetrievalRepository,
  type RetrievalCandidate,
  type RetrievalMetadataFilters,
  type RetrievalSource,
  type SearchDenseInput,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  filterRetrievalCandidatesByProjectionSet,
  mapRetrievalCandidateRow,
  normalizeRetrievalPermissionScope,
} from "./retrieval-candidates";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import {
  type HybridRetrievalItem,
  type RetrievalFusionRuntime,
  fuseRetrievalCandidates,
  fuseRetrievalCandidatesWithRuntime,
} from "./retrieval-fusion";
import { type RetrievalPlanner, defaultRetrievalPlan } from "./retrieval-planner";
import { rerankHybridRetrievalItems } from "./retrieval-rerank";
import { normalizeMixedLanguageFtsText } from "./retrieval-text-utils";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";
import { TIDB_FTS_TOKENIZER_VERSION, createTidbFtsQueryTerms } from "./tidb-fts-postings";

export interface DatabaseHybridRetrievalRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxTopK: number;
  /** Production query repositories fail closed unless a fixed published snapshot id is supplied. */
  readonly requirePublishedSnapshot?: boolean | undefined;
}

export interface BasicHybridRetrieverOptions {
  readonly degradation?:
    | {
        readonly denseFailure?: "fail-closed" | "fts-only" | undefined;
        readonly ftsFailure?: "dense-only" | "fail-closed" | undefined;
        readonly rerankFailure?: "fail-closed" | "skip-rerank" | undefined;
      }
    | undefined;
  readonly fusion?: RetrievalFusionRuntime | undefined;
  readonly maxRerankCandidates?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly planner?: RetrievalPlanner | undefined;
  readonly publishedProjectionMembership?:
    | Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">
    | undefined;
  readonly reranker?: RerankerProvider | undefined;
  readonly rerankerModel?: string | undefined;
  readonly repository: HybridRetrievalRepository;
  readonly rrfK?: number;
  /** Production retrievers fail closed before any leg runs when the query has no fixed head. */
  readonly strictPublishedReads?: boolean | undefined;
}

export class PublishedProjectionSnapshotRequiredError extends Error {
  constructor() {
    super("Hybrid retrieval requires a published projection snapshot");
    this.name = "PublishedProjectionSnapshotRequiredError";
  }
}

export class PublishedProjectionPermissionScopeRequiredError extends Error {
  constructor() {
    super("Published retrieval requires a server-issued permission scope");
    this.name = "PublishedProjectionPermissionScopeRequiredError";
  }
}

export function createDatabaseHybridRetrievalRepository({
  database,
  maxTopK,
  requirePublishedSnapshot = false,
}: DatabaseHybridRetrievalRepositoryOptions): HybridRetrievalRepository {
  if (maxTopK < 1) {
    throw new Error("Hybrid retrieval maxTopK must be at least 1");
  }

  const tableName = "index_projections";
  const projectionAlias = "p";
  const nodeAlias = "n";
  const artifactAlias = "pa";
  const documentAlias = "da";

  const runVectorSearch = async ({
    denseProjectionModel,
    denseProjectionStatuses,
    denseProjectionVersion,
    filters,
    knowledgeSpaceId,
    permissionScope,
    projectionSetCandidateFingerprint,
    projectionSetFingerprint,
    projectionSetPublicationId,
    projectionSetReadMode,
    queryVector,
    source,
    tenantId,
    topK,
    vectorColumn,
  }: SearchDenseInput & {
    readonly source: RetrievalSource;
    readonly vectorColumn: "dense_vector" | "visual_vector";
  }): Promise<RetrievalCandidate[]> => {
    validateHybridTopK(topK, maxTopK);
    validateHybridQueryVector(queryVector);
    assertDatabasePublishedReadScope({
      publicationId: projectionSetPublicationId,
      requirePublishedSnapshot,
      tenantId,
    });
    assertPublishedPermissionScope(permissionScope, requirePublishedSnapshot);
    const vectorParam = JSON.stringify([...queryVector]);
    // PostgreSQL placeholders are numbered, while TiDB `?` placeholders are bound strictly
    // in textual order. The vector score expression appears in SELECT before the space id in
    // WHERE, so TiDB must bind the score vector first.
    const params: DatabaseQueryValue[] =
      database.dialect === "postgres" ? [knowledgeSpaceId, vectorParam] : [vectorParam];
    const vectorRef = qualifiedDatabaseIdentifier(database, projectionAlias, vectorColumn);
    const scoreSql =
      database.dialect === "postgres"
        ? `1 - (${vectorRef} <=> ${databasePlaceholder(database, 2)}::vector)`
        : `1 - VEC_COSINE_DISTANCE(${vectorRef}, CAST(${databasePlaceholder(database, 1)} AS VECTOR))`;
    const publicationMemberJoinSql = retrievalPublishedMemberJoinSql({
      database,
      params,
      projectionAlias,
      publicationId: projectionSetPublicationId,
      tenantId,
    });
    if (database.dialect === "tidb") {
      // TiDB placeholders bind in textual order: SELECT vector, publication-member JOIN, then
      // the knowledge-space WHERE predicate.
      params.push(knowledgeSpaceId);
    }
    const metadataFilters = normalizeRetrievalMetadataFilters(filters);
    const projectionFilterSql = retrievalDenseProjectionFilterSql({
      database,
      dimension: queryVector.length,
      model: denseProjectionModel,
      params,
      projectionAlias,
      projectionVersion: denseProjectionVersion,
      publishedOnly: projectionSetPublicationId !== undefined,
      statuses: denseProjectionStatuses,
      vectorColumn,
    });
    const accessFilterSql = retrievalAccessFilterSql({
      database,
      documentAlias,
      nodeAlias,
      params,
      permissionScope,
      projectionAlias,
      projectionSetCandidateFingerprint,
      projectionSetFingerprint,
      projectionSetPublicationId,
      projectionSetReadMode,
    });
    const filterSql = retrievalMetadataFilterSql(
      database,
      projectionAlias,
      nodeAlias,
      documentAlias,
      metadataFilters,
      params,
    );
    // ORDER BY occurs after every WHERE predicate, so its TiDB vector is appended only after
    // access and metadata filter parameters have been bound.
    const orderBySql =
      database.dialect === "postgres"
        ? `${vectorRef} <=> ${databasePlaceholder(database, 2)}::vector ASC`
        : (() => {
            params.push(vectorParam);
            return `VEC_COSINE_DISTANCE(${vectorRef}, CAST(${databasePlaceholder(
              database,
              params.length,
            )} AS VECTOR)) ASC`;
          })();
    params.push(topK);
    const limitPlaceholder = databasePlaceholder(database, params.length);
    // `<vectorColumn> IS NOT NULL` keeps each leg to its own projections: text/text-surrogate rows
    // populate dense_vector (visual_vector NULL) and visual-asset rows populate visual_vector
    // (dense_vector NULL), so a text query never scores a visual-space vector and vice-versa.
    const result = await database.execute({
      maxRows: topK,
      operation: "select",
      sql: `SELECT ${retrievalSelectSql(
        database,
        projectionAlias,
        nodeAlias,
        artifactAlias,
        documentAlias,
        scoreSql,
      )} FROM ${quoteDatabaseIdentifier(database, tableName)} ${projectionAlias} ${retrievalJoinSql(
        database,
        projectionAlias,
        nodeAlias,
        artifactAlias,
        documentAlias,
      )}${publicationMemberJoinSql} WHERE ${qualifiedDatabaseIdentifier(
        database,
        projectionAlias,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 1)} AND ${qualifiedDatabaseIdentifier(
        database,
        projectionAlias,
        "type",
      )} = 'dense-vector'${projectionFilterSql} AND ${vectorRef} IS NOT NULL${accessFilterSql}${filterSql} ORDER BY ${orderBySql} LIMIT ${limitPlaceholder};`,
      params,
      tableName,
    });

    return result.rows.map((row) => mapRetrievalCandidateRow(row, source));
  };

  return {
    publishedMembershipEnforced: true,
    searchDense: (input) =>
      runVectorSearch({ ...input, source: "dense", vectorColumn: "dense_vector" }),
    searchVisualDense: (input) =>
      runVectorSearch({ ...input, source: "visual", vectorColumn: "visual_vector" }),
    searchFts: async ({
      filters,
      knowledgeSpaceId,
      permissionScope,
      projectionSetCandidateFingerprint,
      projectionSetFingerprint,
      projectionSetPublicationId,
      projectionSetReadMode,
      query,
      tenantId,
      topK,
    }) => {
      validateHybridTopK(topK, maxTopK);
      assertDatabasePublishedReadScope({
        publicationId: projectionSetPublicationId,
        requirePublishedSnapshot,
        tenantId,
      });
      assertPublishedPermissionScope(permissionScope, requirePublishedSnapshot);
      const normalizedQuery = normalizeMixedLanguageFtsText(query);

      if (!normalizedQuery) {
        throw new Error("Hybrid retrieval query must not be empty");
      }

      if (database.dialect === "tidb") {
        const queryTerms = createTidbFtsQueryTerms(query);
        const params: DatabaseQueryValue[] = [];
        const postingAlias = "fts_posting";
        // Restrict immutable publication membership before grouping. Otherwise historical/common
        // terms could dominate work or candidate ordering even though they can never be returned.
        const boundedPublicationMemberJoinSql = retrievalBoundedPublishedMemberJoinSql({
          database,
          params,
          postingAlias,
          publicationId: projectionSetPublicationId,
          tenantId,
        });
        params.push(knowledgeSpaceId, TIDB_FTS_TOKENIZER_VERSION);
        const postingSpacePlaceholder = databasePlaceholder(database, params.length - 1);
        const tokenizerPlaceholder = databasePlaceholder(database, params.length);
        const hashPlaceholders = queryTerms.hashes.map((hash) => {
          params.push(hash);
          return databasePlaceholder(database, params.length);
        });
        const publicationMemberJoinSql = retrievalPublishedMemberJoinSql({
          database,
          params,
          projectionAlias,
          publicationId: projectionSetPublicationId,
          tenantId,
        });
        const metadataFilters = normalizeRetrievalMetadataFilters(filters);
        const accessFilterSql = retrievalAccessFilterSql({
          database,
          documentAlias,
          nodeAlias,
          params,
          permissionScope,
          projectionAlias,
          projectionSetCandidateFingerprint,
          projectionSetFingerprint,
          projectionSetPublicationId,
          projectionSetReadMode,
        });
        const filterSql = retrievalMetadataFilterSql(
          database,
          projectionAlias,
          nodeAlias,
          documentAlias,
          metadataFilters,
          params,
        );
        params.push(topK);
        const limitPlaceholder = databasePlaceholder(database, params.length);
        const hitAlias = "fts_hits";
        const result = await database.execute({
          maxRows: topK,
          operation: "select",
          params,
          sql: `SELECT ${retrievalSelectSql(
            database,
            projectionAlias,
            nodeAlias,
            artifactAlias,
            documentAlias,
            `${hitAlias}.${quoteDatabaseIdentifier(database, "score")}`,
          )} FROM ${quoteDatabaseIdentifier(database, tableName)} ${projectionAlias} JOIN (SELECT ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "knowledge_space_id",
          )}, ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "projection_id",
          )}, CAST(COUNT(DISTINCT ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "term_hash",
          )}) AS DOUBLE) / ${queryTerms.hashes.length} AS ${quoteDatabaseIdentifier(
            database,
            "score",
          )}, SUM(${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "term_frequency",
          )}) AS ${quoteDatabaseIdentifier(database, "matched_frequency")} FROM ${quoteDatabaseIdentifier(
            database,
            "index_projection_fts_postings",
          )} ${postingAlias}${boundedPublicationMemberJoinSql} WHERE ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "knowledge_space_id",
          )} = ${postingSpacePlaceholder} AND ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "tokenizer_version",
          )} = ${tokenizerPlaceholder} AND ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "term_hash",
          )} IN (${hashPlaceholders.join(", ")}) GROUP BY ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "knowledge_space_id",
          )}, ${qualifiedDatabaseIdentifier(
            database,
            postingAlias,
            "projection_id",
          )}) ${hitAlias} ON ${hitAlias}.${quoteDatabaseIdentifier(
            database,
            "projection_id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "id",
          )} AND ${hitAlias}.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "knowledge_space_id",
          )} ${retrievalJoinSql(
            database,
            projectionAlias,
            nodeAlias,
            artifactAlias,
            documentAlias,
          )}${publicationMemberJoinSql} WHERE ${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "type",
          )} = 'fts' AND ${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "status",
          )} = 'ready'${accessFilterSql}${filterSql} ORDER BY ${hitAlias}.${quoteDatabaseIdentifier(
            database,
            "score",
          )} DESC, ${hitAlias}.${quoteDatabaseIdentifier(
            database,
            "matched_frequency",
          )} DESC, ${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "id",
          )} ASC LIMIT ${limitPlaceholder};`,
          tableName: "index_projection_fts_postings",
        });

        return result.rows.map((row) => mapRetrievalCandidateRow(row, "fts"));
      }

      const params: DatabaseQueryValue[] = [knowledgeSpaceId, normalizedQuery];
      const ftsDocumentRef = qualifiedDatabaseIdentifier(database, projectionAlias, "fts_document");
      const scoreSql = `ts_rank(${ftsDocumentRef}, plainto_tsquery('simple', ${databasePlaceholder(
        database,
        2,
      )}))`;
      const publicationMemberJoinSql = retrievalPublishedMemberJoinSql({
        database,
        params,
        projectionAlias,
        publicationId: projectionSetPublicationId,
        tenantId,
      });
      const predicateSql = `${ftsDocumentRef} @@ plainto_tsquery('simple', ${databasePlaceholder(
        database,
        2,
      )})`;
      const metadataFilters = normalizeRetrievalMetadataFilters(filters);
      const accessFilterSql = retrievalAccessFilterSql({
        database,
        documentAlias,
        nodeAlias,
        params,
        permissionScope,
        projectionAlias,
        projectionSetCandidateFingerprint,
        projectionSetFingerprint,
        projectionSetPublicationId,
        projectionSetReadMode,
      });
      const filterSql = retrievalMetadataFilterSql(
        database,
        projectionAlias,
        nodeAlias,
        documentAlias,
        metadataFilters,
        params,
      );
      params.push(topK);
      const limitPlaceholder = databasePlaceholder(database, params.length);
      const result = await database.execute({
        maxRows: topK,
        operation: "select",
        sql: `SELECT ${retrievalSelectSql(
          database,
          projectionAlias,
          nodeAlias,
          artifactAlias,
          documentAlias,
          scoreSql,
        )} FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} ${projectionAlias} ${retrievalJoinSql(
          database,
          projectionAlias,
          nodeAlias,
          artifactAlias,
          documentAlias,
        )}${publicationMemberJoinSql} WHERE ${qualifiedDatabaseIdentifier(
          database,
          projectionAlias,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${qualifiedDatabaseIdentifier(
          database,
          projectionAlias,
          "type",
        )} = 'fts' AND ${qualifiedDatabaseIdentifier(
          database,
          projectionAlias,
          "status",
        )} = 'ready' AND ${predicateSql}${accessFilterSql}${filterSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "score",
        )} DESC LIMIT ${limitPlaceholder};`,
        params,
        tableName,
      });

      return result.rows.map((row) => mapRetrievalCandidateRow(row, "fts"));
    },
  };
}

export function createBasicHybridRetriever({
  degradation = {},
  fusion,
  maxRerankCandidates = 200,
  now = Date.now,
  planner,
  publishedProjectionMembership,
  reranker,
  rerankerModel,
  repository,
  rrfK = 60,
  strictPublishedReads = false,
}: BasicHybridRetrieverOptions): BasicHybridRetriever {
  if (reranker && !rerankerModel?.trim()) {
    throw new Error("Hybrid retrieval rerankerModel is required when reranker is configured");
  }

  if (!Number.isInteger(maxRerankCandidates) || maxRerankCandidates < 1) {
    throw new Error("Hybrid retrieval maxRerankCandidates must be at least 1");
  }

  return {
    retrieve: async (input) => {
      if (!Number.isInteger(input.limit) || input.limit < 1) {
        throw new Error("Hybrid retrieval limit must be at least 1");
      }

      if (!Number.isFinite(rrfK) || rrfK < 1) {
        throw new Error("Hybrid retrieval rrfK must be at least 1");
      }

      validateHybridQueryVector(input.queryVector);
      const publishedScope = resolvePublishedRetrievalScope(input, strictPublishedReads);
      assertPublishedPermissionScope(input.permissionScope, strictPublishedReads);
      if (
        publishedScope &&
        !repository.publishedMembershipEnforced &&
        !publishedProjectionMembership
      ) {
        throw new Error(
          "Hybrid retrieval published snapshot requires authoritative repository filtering or a membership checker",
        );
      }
      const totalStartedAt = now();
      const plan =
        planner?.plan({
          mode: input.mode,
          query: input.query,
          topK: input.topK,
          traceId: input.traceId,
        }) ??
        defaultRetrievalPlan({
          query: input.query,
          topK: input.topK,
        });
      const degradationFlags: string[] = [];
      const [denseSettled, ftsSettled] = await Promise.allSettled([
        timed(now, () =>
          repository.searchDense({
            denseProjectionModel: input.denseProjectionModel,
            denseProjectionStatuses: input.denseProjectionStatuses,
            denseProjectionVersion: input.denseProjectionVersion,
            filters: input.filters,
            knowledgeSpaceId: input.knowledgeSpaceId,
            permissionScope: input.permissionScope,
            projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
            projectionSetFingerprint: input.projectionSetFingerprint,
            ...(publishedScope ? { projectionSetPublicationId: publishedScope.publicationId } : {}),
            projectionSetReadMode: input.projectionSetReadMode,
            queryVector: input.queryVector,
            ...(publishedScope
              ? { tenantId: publishedScope.tenantId }
              : input.tenantId
                ? { tenantId: input.tenantId }
                : {}),
            topK: plan.denseTopK,
          }),
        ),
        timed(now, () =>
          repository.searchFts({
            filters: input.filters,
            knowledgeSpaceId: input.knowledgeSpaceId,
            permissionScope: input.permissionScope,
            projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
            projectionSetFingerprint: input.projectionSetFingerprint,
            ...(publishedScope ? { projectionSetPublicationId: publishedScope.publicationId } : {}),
            projectionSetReadMode: input.projectionSetReadMode,
            query: input.query,
            ...(publishedScope
              ? { tenantId: publishedScope.tenantId }
              : input.tenantId
                ? { tenantId: input.tenantId }
                : {}),
            topK: plan.ftsTopK,
          }),
        ),
      ]);
      const denseResult =
        denseSettled.status === "fulfilled"
          ? denseSettled.value
          : degradeRetrievalLeg({
              flag: "dense-failed:fts-only",
              flags: degradationFlags,
              mode: degradation.denseFailure,
              requiredMode: "fts-only",
              reason: denseSettled.reason,
            });
      const ftsResult =
        ftsSettled.status === "fulfilled"
          ? ftsSettled.value
          : degradeRetrievalLeg({
              flag: "fts-failed:dense-only",
              flags: degradationFlags,
              mode: degradation.ftsFailure,
              requiredMode: "dense-only",
              reason: ftsSettled.reason,
            });
      const metadataFilters = normalizeRetrievalMetadataFilters(input.filters);
      const denseAfterMetadata = filterRetrievalCandidatesByMetadata(
        denseResult.value,
        metadataFilters,
      );
      const ftsAfterMetadata = filterRetrievalCandidatesByMetadata(
        ftsResult.value,
        metadataFilters,
      );
      const metadataFilteredCandidates =
        denseResult.value.length +
        ftsResult.value.length -
        denseAfterMetadata.length -
        ftsAfterMetadata.length;
      const allowedPermissionScope = normalizeRetrievalPermissionScope(input.permissionScope);
      const denseCandidates = filterRetrievalCandidatesByPermission(
        denseAfterMetadata,
        allowedPermissionScope,
      );
      const ftsCandidates = filterRetrievalCandidatesByPermission(
        ftsAfterMetadata,
        allowedPermissionScope,
      );
      const permissionFilteredCandidates =
        denseAfterMetadata.length +
        ftsAfterMetadata.length -
        denseCandidates.length -
        ftsCandidates.length;
      const legacyDenseProjectionCandidates = publishedScope
        ? denseCandidates
        : filterRetrievalCandidatesByProjectionSet(denseCandidates, {
            candidateFingerprint: input.projectionSetCandidateFingerprint,
            mode: input.projectionSetReadMode,
            publishedFingerprint: input.projectionSetFingerprint,
          });
      const legacyFtsProjectionCandidates = publishedScope
        ? ftsCandidates
        : filterRetrievalCandidatesByProjectionSet(ftsCandidates, {
            candidateFingerprint: input.projectionSetCandidateFingerprint,
            mode: input.projectionSetReadMode,
            publishedFingerprint: input.projectionSetFingerprint,
          });
      const membershipFiltered =
        publishedScope && publishedProjectionMembership
          ? await filterCandidatesByPublishedProjectionMembership({
              candidates: [...legacyDenseProjectionCandidates, ...legacyFtsProjectionCandidates],
              membership: publishedProjectionMembership,
              scope: publishedScope,
            })
          : {
              allowedProjectionIds: undefined,
              filteredCandidates: 0,
            };
      const denseProjectionCandidates = membershipFiltered.allowedProjectionIds
        ? legacyDenseProjectionCandidates.filter((candidate) =>
            membershipFiltered.allowedProjectionIds?.has(candidate.projectionId),
          )
        : legacyDenseProjectionCandidates;
      const ftsProjectionCandidates = membershipFiltered.allowedProjectionIds
        ? legacyFtsProjectionCandidates.filter((candidate) =>
            membershipFiltered.allowedProjectionIds?.has(candidate.projectionId),
          )
        : legacyFtsProjectionCandidates;
      const projectionFilteredCandidates =
        denseCandidates.length +
        ftsCandidates.length -
        legacyDenseProjectionCandidates.length -
        legacyFtsProjectionCandidates.length +
        membershipFiltered.filteredCandidates;
      const projectionCandidates = [...denseProjectionCandidates, ...ftsProjectionCandidates];
      const multimodalCandidateCount = countMultimodalProjectionCandidates(projectionCandidates);
      const visualEmbeddingCandidateCount =
        countVisualEmbeddingProjectionCandidates(projectionCandidates);
      const preRerankLimit =
        reranker && plan.rerankCandidateLimit > 0
          ? Math.min(Math.max(input.limit, plan.rerankCandidateLimit), maxRerankCandidates)
          : input.limit;
      const fusionResult = timedSync(now, () =>
        fusion
          ? fuseRetrievalCandidatesWithRuntime({
              dense: denseProjectionCandidates,
              fts: ftsProjectionCandidates,
              fusion,
              limit: preRerankLimit,
              plan,
              rrfK,
            })
          : fuseRetrievalCandidates({
              dense: denseProjectionCandidates,
              fts: ftsProjectionCandidates,
              limit: preRerankLimit,
              rrfK,
            }),
      );
      let rerankResult: { readonly durationMs: number; readonly value: HybridRetrievalItem[] };

      if (reranker && plan.rerankCandidateLimit > 0) {
        try {
          rerankResult = await timed(now, () =>
            rerankHybridRetrievalItems({
              items: fusionResult.value,
              limit: input.limit,
              model: rerankerModel ?? "",
              query: input.query,
              reranker,
              ...(input.tenantId ? { tenantId: input.tenantId } : {}),
            }),
          );
        } catch (error) {
          if (degradation.rerankFailure !== "skip-rerank") {
            throw error;
          }

          degradationFlags.push("rerank-failed:skipped");
          rerankResult = {
            durationMs: 0,
            value: fusionResult.value.slice(0, input.limit),
          };
        }
      } else {
        rerankResult = {
          durationMs: 0,
          value: fusionResult.value.slice(0, input.limit),
        };
      }

      return {
        items: rerankResult.value,
        metrics: {
          ...(degradationFlags.length > 0 ? { degradationFlags } : {}),
          denseCandidates: denseResult.value.length,
          denseMs: denseResult.durationMs,
          ftsCandidates: ftsResult.value.length,
          ftsMs: ftsResult.durationMs,
          fusedCandidates: fusionResult.value.length,
          fusionMs: fusionResult.durationMs,
          ...(metadataFilteredCandidates > 0 ? { metadataFilteredCandidates } : {}),
          ...(multimodalCandidateCount > 0
            ? { multimodalCandidates: multimodalCandidateCount }
            : {}),
          ...(permissionFilteredCandidates > 0 ? { permissionFilteredCandidates } : {}),
          ...(projectionFilteredCandidates > 0 ? { projectionFilteredCandidates } : {}),
          ...(reranker && plan.rerankCandidateLimit > 0
            ? {
                rerankCandidates: fusionResult.value.length,
                rerankMs: rerankResult.durationMs,
              }
            : {}),
          totalMs: now() - totalStartedAt,
          ...(visualEmbeddingCandidateCount > 0
            ? { visualEmbeddingCandidates: visualEmbeddingCandidateCount }
            : {}),
        },
        plan,
      };
    },
  };
}

// Count DISTINCT multimodal nodes: `projectionCandidates` merges the dense and fts legs, so a node
// retrieved by both legs (or via two dense projections) must not be counted more than once.
function countMultimodalProjectionCandidates(candidates: readonly RetrievalCandidate[]): number {
  return distinctNodeCount(candidates, (candidate) => isPlainObject(candidate.metadata.multimodal));
}

function countVisualEmbeddingProjectionCandidates(
  candidates: readonly RetrievalCandidate[],
): number {
  return distinctNodeCount(candidates, (candidate) => {
    const multimodal = candidate.metadata.multimodal;

    return isPlainObject(multimodal) && multimodal.projectionRole === "visual-asset";
  });
}

function distinctNodeCount(
  candidates: readonly RetrievalCandidate[],
  predicate: (candidate: RetrievalCandidate) => boolean,
): number {
  const nodeIds = new Set<string>();

  for (const candidate of candidates) {
    if (predicate(candidate)) {
      nodeIds.add(candidate.nodeId);
    }
  }

  return nodeIds.size;
}

function retrievalSelectSql(
  database: DatabaseAdapter,
  projectionAlias: string,
  nodeAlias: string,
  artifactAlias: string,
  documentAlias: string,
  scoreSql: string,
): string {
  return [
    `${qualifiedDatabaseIdentifier(database, projectionAlias, "id")} AS ${quoteDatabaseIdentifier(
      database,
      "projection_id",
    )}`,
    `${qualifiedDatabaseIdentifier(database, projectionAlias, "node_id")} AS ${quoteDatabaseIdentifier(
      database,
      "node_id",
    )}`,
    `${qualifiedDatabaseIdentifier(database, projectionAlias, "metadata")} AS ${quoteDatabaseIdentifier(
      database,
      "metadata",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "metadata")} AS ${quoteDatabaseIdentifier(
      database,
      "node_metadata",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "kind")} AS ${quoteDatabaseIdentifier(
      database,
      "node_kind",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "text")} AS ${quoteDatabaseIdentifier(
      database,
      "text",
    )}`,
    `${qualifiedDatabaseIdentifier(database, documentAlias, "metadata")} AS ${quoteDatabaseIdentifier(
      database,
      "document_metadata",
    )}`,
    `${qualifiedDatabaseIdentifier(database, documentAlias, "mime_type")} AS ${quoteDatabaseIdentifier(
      database,
      "document_type",
    )}`,
    `${qualifiedDatabaseIdentifier(database, documentAlias, "source_id")} AS ${quoteDatabaseIdentifier(
      database,
      "source_id",
    )}`,
    `${qualifiedDatabaseIdentifier(database, documentAlias, "created_at")} AS ${quoteDatabaseIdentifier(
      database,
      "document_created_at",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "document_asset_id")} AS ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "permission_scope")} AS ${quoteDatabaseIdentifier(
      database,
      "permission_scope",
    )}`,
    `${qualifiedDatabaseIdentifier(database, artifactAlias, "version")} AS ${quoteDatabaseIdentifier(
      database,
      "document_version",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "artifact_hash")} AS ${quoteDatabaseIdentifier(
      database,
      "artifact_hash",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "source_location")} AS ${quoteDatabaseIdentifier(
      database,
      "source_location",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "start_offset")} AS ${quoteDatabaseIdentifier(
      database,
      "start_offset",
    )}`,
    `${qualifiedDatabaseIdentifier(database, nodeAlias, "end_offset")} AS ${quoteDatabaseIdentifier(
      database,
      "end_offset",
    )}`,
    `${scoreSql} AS ${quoteDatabaseIdentifier(database, "score")}`,
  ].join(", ");
}

function retrievalJoinSql(
  database: DatabaseAdapter,
  projectionAlias: string,
  nodeAlias: string,
  artifactAlias: string,
  documentAlias: string,
): string {
  return `JOIN ${quoteDatabaseIdentifier(database, "knowledge_nodes")} ${nodeAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    projectionAlias,
    "node_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    projectionAlias,
    "knowledge_space_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "publication_generation_id",
  )} ${database.dialect === "postgres" ? "IS NOT DISTINCT FROM" : "<=>"} ${qualifiedDatabaseIdentifier(
    database,
    projectionAlias,
    "publication_generation_id",
  )} JOIN ${quoteDatabaseIdentifier(database, "parse_artifacts")} ${artifactAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    artifactAlias,
    "id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "parse_artifact_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    artifactAlias,
    "document_asset_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "document_asset_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    artifactAlias,
    "artifact_hash",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "artifact_hash",
  )} JOIN ${quoteDatabaseIdentifier(database, "document_assets")} ${documentAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    documentAlias,
    "id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    nodeAlias,
    "document_asset_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    documentAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(database, nodeAlias, "knowledge_space_id")}`;
}

function retrievalBoundedPublishedMemberJoinSql({
  database,
  params,
  postingAlias,
  publicationId,
  tenantId,
}: {
  readonly database: DatabaseAdapter;
  readonly params: DatabaseQueryValue[];
  readonly postingAlias: string;
  readonly publicationId: string | undefined;
  readonly tenantId: string | undefined;
}): string {
  if (publicationId === undefined) {
    return "";
  }

  const normalizedTenantId = requireNonEmptyPublishedScopeValue(tenantId, "tenantId");
  const normalizedPublicationId = requireNonEmptyPublishedScopeValue(
    publicationId,
    "publicationId",
  );
  params.push(normalizedTenantId, normalizedPublicationId);
  const tenantPlaceholder = databasePlaceholder(database, params.length - 1);
  const publicationPlaceholder = databasePlaceholder(database, params.length);
  const publicationAlias = "bounded_pub";
  const memberAlias = "bounded_pm";

  return ` JOIN ${quoteDatabaseIdentifier(
    database,
    "projection_set_publications",
  )} ${publicationAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "tenant_id",
  )} = ${tenantPlaceholder} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    postingAlias,
    "knowledge_space_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "id",
  )} = ${publicationPlaceholder} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "status",
  )} IN ('published', 'superseded') JOIN ${quoteDatabaseIdentifier(
    database,
    "projection_set_publication_members",
  )} ${memberAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "tenant_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "tenant_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    postingAlias,
    "knowledge_space_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "publication_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "component_type",
  )} = 'index-projection' AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "component_key",
  )} = ${qualifiedDatabaseIdentifier(database, postingAlias, "projection_id")}`;
}

function retrievalPublishedMemberJoinSql({
  database,
  params,
  projectionAlias,
  publicationId,
  tenantId,
}: {
  readonly database: DatabaseAdapter;
  readonly params: DatabaseQueryValue[];
  readonly projectionAlias: string;
  readonly publicationId: string | undefined;
  readonly tenantId: string | undefined;
}): string {
  if (publicationId === undefined) {
    return "";
  }

  const normalizedTenantId = requireNonEmptyPublishedScopeValue(tenantId, "tenantId");
  const normalizedPublicationId = requireNonEmptyPublishedScopeValue(
    publicationId,
    "publicationId",
  );
  params.push(normalizedTenantId, normalizedPublicationId);
  const tenantPlaceholder = databasePlaceholder(database, params.length - 1);
  const publicationPlaceholder = databasePlaceholder(database, params.length);
  const publicationAlias = "retrieval_pub";
  const memberAlias = "pm";

  return ` JOIN ${quoteDatabaseIdentifier(
    database,
    "projection_set_publications",
  )} ${publicationAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "tenant_id",
  )} = ${tenantPlaceholder} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    projectionAlias,
    "knowledge_space_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "id",
  )} = ${publicationPlaceholder} AND ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "status",
  )} IN ('published', 'superseded') JOIN ${quoteDatabaseIdentifier(
    database,
    "projection_set_publication_members",
  )} ${memberAlias} ON ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "tenant_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "tenant_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "knowledge_space_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "knowledge_space_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "publication_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    publicationAlias,
    "id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "component_type",
  )} = 'index-projection' AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "component_key",
  )} = ${qualifiedDatabaseIdentifier(database, projectionAlias, "id")} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "generation_id",
  )} = ${qualifiedDatabaseIdentifier(
    database,
    projectionAlias,
    "publication_generation_id",
  )} AND ${qualifiedDatabaseIdentifier(
    database,
    memberAlias,
    "document_asset_id",
  )} = ${qualifiedDatabaseIdentifier(database, "n", "document_asset_id")}`;
}

function retrievalMetadataFilterSql(
  database: DatabaseAdapter,
  projectionAlias: string,
  nodeAlias: string,
  documentAlias: string,
  filters: RetrievalMetadataFilters,
  params: DatabaseQueryValue[],
): string {
  const predicates: string[] = [];
  addInFilterSql(
    database,
    predicates,
    params,
    qualifiedDatabaseIdentifier(database, nodeAlias, "id"),
    filters.nodeIds,
  );
  addInFilterSql(
    database,
    predicates,
    params,
    qualifiedDatabaseIdentifier(database, nodeAlias, "kind"),
    filters.nodeKinds,
  );
  addInFilterSql(
    database,
    predicates,
    params,
    qualifiedDatabaseIdentifier(database, documentAlias, "mime_type"),
    filters.documentTypes,
  );
  addInFilterSql(
    database,
    predicates,
    params,
    qualifiedDatabaseIdentifier(database, documentAlias, "source_id"),
    filters.sourceIds,
  );

  if (filters.createdAfter) {
    params.push(filters.createdAfter);
    predicates.push(
      `${qualifiedDatabaseIdentifier(database, documentAlias, "created_at")} >= ${databasePlaceholder(
        database,
        params.length,
      )}`,
    );
  }

  if (filters.createdBefore) {
    params.push(filters.createdBefore);
    predicates.push(
      `${qualifiedDatabaseIdentifier(database, documentAlias, "created_at")} <= ${databasePlaceholder(
        database,
        params.length,
      )}`,
    );
  }

  addMetadataOverlapFilterSql({
    aliases: [projectionAlias, nodeAlias, documentAlias],
    database,
    keys: ["entities", "graphEntities", "graphEntityIds"],
    params,
    predicates,
    values: filters.entities,
  });
  addMetadataOverlapFilterSql({
    aliases: [projectionAlias, nodeAlias, documentAlias],
    database,
    keys: ["tags"],
    params,
    predicates,
    values: filters.tags,
  });
  addMetadataOverlapFilterSql({
    aliases: [projectionAlias, nodeAlias, documentAlias],
    database,
    keys: ["language", "languages"],
    params,
    predicates,
    values: filters.languages,
  });
  addMetadataOverlapFilterSql({
    aliases: [projectionAlias, nodeAlias, documentAlias],
    database,
    keys: ["freshnessStatus", "freshnessStatuses"],
    params,
    predicates,
    values: filters.freshnessStatuses,
  });

  return predicates.length === 0 ? "" : ` AND ${predicates.join(" AND ")}`;
}

function retrievalAccessFilterSql({
  database,
  documentAlias,
  nodeAlias,
  params,
  permissionScope,
  projectionAlias,
  projectionSetCandidateFingerprint,
  projectionSetFingerprint,
  projectionSetPublicationId,
  projectionSetReadMode,
}: {
  readonly database: DatabaseAdapter;
  readonly documentAlias: string;
  readonly nodeAlias: string;
  readonly params: DatabaseQueryValue[];
  readonly permissionScope: readonly string[] | undefined;
  readonly projectionAlias: string;
  readonly projectionSetCandidateFingerprint: string | undefined;
  readonly projectionSetFingerprint: string | undefined;
  readonly projectionSetPublicationId: string | undefined;
  readonly projectionSetReadMode: "evaluation" | "preview" | "published" | undefined;
}): string {
  const predicates = [
    `${qualifiedDatabaseIdentifier(database, documentAlias, "parser_status")} = 'parsed'`,
    `${qualifiedDatabaseIdentifier(database, documentAlias, "lifecycle_state")} = 'active'`,
    readableDocumentParentSourcePredicateSql(
      database,
      documentAlias,
      `${documentAlias}_parent_source`,
    ),
  ];
  const allowedPermissionScope = normalizeRetrievalPermissionScope(permissionScope);

  if (allowedPermissionScope !== undefined) {
    params.push(JSON.stringify([...allowedPermissionScope]));
    const scopePlaceholder = databasePlaceholder(database, params.length);
    const permissionRef = qualifiedDatabaseIdentifier(database, nodeAlias, "permission_scope");
    predicates.push(
      database.dialect === "postgres"
        ? `(jsonb_array_length(${permissionRef}) = 0 OR ${scopePlaceholder}::jsonb @> ${permissionRef})`
        : `(JSON_LENGTH(${permissionRef}) = 0 OR JSON_CONTAINS(CAST(${scopePlaceholder} AS JSON), ${permissionRef}))`,
    );
  }

  // A fixed publication id is authoritative. Metadata fingerprints remain only for legacy
  // preview/evaluation callers that have no immutable published snapshot.
  const fingerprints = projectionSetPublicationId
    ? []
    : allowedProjectionSetFingerprints({
        candidateFingerprint: projectionSetCandidateFingerprint,
        mode: projectionSetReadMode,
        publishedFingerprint: projectionSetFingerprint,
      });
  if (fingerprints.length > 0) {
    const fingerprintRef =
      database.dialect === "postgres"
        ? `${qualifiedDatabaseIdentifier(database, projectionAlias, "metadata")} ->> 'projectionSetFingerprint'`
        : `JSON_UNQUOTE(JSON_EXTRACT(${qualifiedDatabaseIdentifier(
            database,
            projectionAlias,
            "metadata",
          )}, '$.projectionSetFingerprint'))`;
    addInFilterSql(database, predicates, params, fingerprintRef, fingerprints);
  }

  return ` AND ${predicates.join(" AND ")}`;
}

function retrievalDenseProjectionFilterSql({
  database,
  dimension,
  model,
  params,
  projectionAlias,
  projectionVersion,
  publishedOnly,
  statuses,
  vectorColumn,
}: {
  readonly database: DatabaseAdapter;
  readonly dimension: number;
  readonly model: string | undefined;
  readonly params: DatabaseQueryValue[];
  readonly projectionAlias: string;
  readonly projectionVersion: number | undefined;
  readonly publishedOnly: boolean;
  readonly statuses: readonly ("building" | "ready")[] | undefined;
  readonly vectorColumn: "dense_vector" | "visual_vector";
}): string {
  const predicates: string[] = [];
  const normalizedStatuses = publishedOnly
    ? ["ready"]
    : statuses
      ? [...new Set(statuses)]
      : ["ready"];

  params.push(dimension);
  predicates.push(
    `${database.dialect === "postgres" ? "vector_dims" : "VEC_DIMS"}(${qualifiedDatabaseIdentifier(
      database,
      projectionAlias,
      vectorColumn,
    )}) = ${databasePlaceholder(database, params.length)}`,
  );

  if (normalizedStatuses.length === 0) {
    throw new Error("Dense projection statuses must contain at least one status");
  }
  for (const status of normalizedStatuses) {
    if (status !== "building" && status !== "ready") {
      throw new Error(`Unsupported dense projection status: ${status}`);
    }
  }

  const statusRef = qualifiedDatabaseIdentifier(database, projectionAlias, "status");
  if (normalizedStatuses.length === 1 && normalizedStatuses[0] === "ready") {
    predicates.push(`${statusRef} = 'ready'`);
  } else {
    addInFilterSql(database, predicates, params, statusRef, normalizedStatuses);
  }

  const normalizedModel = model?.trim();
  if (!normalizedModel) {
    throw new Error("Dense projection model is required for database vector search");
  }
  params.push(normalizedModel);
  predicates.push(
    `${qualifiedDatabaseIdentifier(database, projectionAlias, "model")} = ${databasePlaceholder(
      database,
      params.length,
    )}`,
  );

  if (projectionVersion !== undefined) {
    if (!Number.isInteger(projectionVersion) || projectionVersion < 1) {
      throw new Error("Dense projection version must be a positive integer");
    }
    params.push(projectionVersion);
    predicates.push(
      `${qualifiedDatabaseIdentifier(
        database,
        projectionAlias,
        "projection_version",
      )} = ${databasePlaceholder(database, params.length)}`,
    );
  }

  return ` AND ${predicates.join(" AND ")}`;
}

function allowedProjectionSetFingerprints({
  candidateFingerprint,
  mode = "published",
  publishedFingerprint,
}: {
  readonly candidateFingerprint: string | undefined;
  readonly mode: "evaluation" | "preview" | "published" | undefined;
  readonly publishedFingerprint: string | undefined;
}): string[] {
  const allowed = new Set<string>();
  const published = publishedFingerprint?.trim();
  const candidate = candidateFingerprint?.trim();

  if (published) {
    allowed.add(published);
  }
  if ((mode === "preview" || mode === "evaluation") && candidate) {
    allowed.add(candidate);
  }

  return [...allowed];
}

function addMetadataOverlapFilterSql({
  aliases,
  database,
  keys,
  params,
  predicates,
  values,
}: {
  readonly aliases: readonly string[];
  readonly database: DatabaseAdapter;
  readonly keys: readonly string[];
  readonly params: DatabaseQueryValue[];
  readonly predicates: string[];
  readonly values: readonly string[] | undefined;
}): void {
  if (!values || values.length === 0) {
    return;
  }

  const matches: string[] = [];

  if (database.dialect === "postgres") {
    params.push(JSON.stringify(values));
    const valuesPlaceholder = databasePlaceholder(database, params.length);

    for (const alias of aliases) {
      const metadataRef = qualifiedDatabaseIdentifier(database, alias, "metadata");
      for (const key of keys) {
        matches.push(
          `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${valuesPlaceholder}::jsonb) AS requested(value) WHERE ${metadataRef} ->> '${key}' = requested.value OR (${metadataRef} -> '${key}') ? requested.value)`,
        );
      }
    }
  } else {
    for (const alias of aliases) {
      const metadataRef = qualifiedDatabaseIdentifier(database, alias, "metadata");
      for (const key of keys) {
        params.push(JSON.stringify(values));
        const valuesPlaceholder = databasePlaceholder(database, params.length);
        const extracted = `JSON_EXTRACT(${metadataRef}, '$.${key}')`;
        matches.push(
          `JSON_OVERLAPS(CASE WHEN ${extracted} IS NULL THEN JSON_ARRAY() WHEN JSON_TYPE(${extracted}) = 'ARRAY' THEN ${extracted} ELSE JSON_ARRAY(JSON_UNQUOTE(${extracted})) END, CAST(${valuesPlaceholder} AS JSON))`,
        );
      }
    }
  }

  predicates.push(`(${matches.join(" OR ")})`);
}

function addInFilterSql(
  database: DatabaseAdapter,
  predicates: string[],
  params: DatabaseQueryValue[],
  columnSql: string,
  values: readonly string[] | undefined,
): void {
  if (!values || values.length === 0) {
    return;
  }

  const placeholders = values.map((value) => {
    params.push(value);
    return databasePlaceholder(database, params.length);
  });
  predicates.push(`${columnSql} IN (${placeholders.join(", ")})`);
}

function validateHybridTopK(topK: number, maxTopK: number): void {
  if (!Number.isInteger(topK) || topK < 1) {
    throw new Error("Hybrid retrieval topK must be at least 1");
  }

  if (topK > maxTopK) {
    throw new Error(`Hybrid retrieval topK exceeds maxTopK=${maxTopK}`);
  }
}

function validateHybridQueryVector(queryVector: readonly number[]): void {
  if (queryVector.length < 1) {
    throw new Error("Hybrid retrieval queryVector must contain at least 1 number");
  }

  if (!queryVector.every((value) => Number.isFinite(value))) {
    throw new Error("Hybrid retrieval queryVector must contain only finite numbers");
  }
}

interface PublishedRetrievalScope {
  readonly knowledgeSpaceId: string;
  readonly publicationId: string;
  readonly tenantId: string;
}

function resolvePublishedRetrievalScope(
  input: RetrieveHybridInput,
  strictPublishedReads: boolean,
): PublishedRetrievalScope | undefined {
  const snapshot = input.projectionSnapshot;
  if (!snapshot) {
    if (strictPublishedReads) {
      throw new PublishedProjectionSnapshotRequiredError();
    }

    return undefined;
  }

  if (snapshot.knowledgeSpaceId !== input.knowledgeSpaceId) {
    throw new Error(
      "Published projection snapshot knowledgeSpaceId does not match retrieval input",
    );
  }
  if (input.tenantId !== undefined && snapshot.tenantId !== input.tenantId) {
    throw new Error("Published projection snapshot tenantId does not match retrieval input");
  }

  return {
    knowledgeSpaceId: snapshot.knowledgeSpaceId,
    publicationId: requireNonEmptyPublishedScopeValue(snapshot.publicationId, "publicationId"),
    tenantId: requireNonEmptyPublishedScopeValue(snapshot.tenantId, "tenantId"),
  };
}

async function filterCandidatesByPublishedProjectionMembership({
  candidates,
  membership,
  scope,
}: {
  readonly candidates: readonly RetrievalCandidate[];
  readonly membership: Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">;
  readonly scope: PublishedRetrievalScope;
}): Promise<{
  readonly allowedProjectionIds: ReadonlySet<string>;
  readonly filteredCandidates: number;
}> {
  const requestedProjectionIds = [
    ...new Set(candidates.map((candidate) => candidate.projectionId)),
  ];
  const checkerInput: FilterProjectionSetPublicationMemberKeysInput = {
    componentKeys: requestedProjectionIds,
    componentType: "index-projection",
    knowledgeSpaceId: scope.knowledgeSpaceId,
    publicationId: scope.publicationId,
    tenantId: scope.tenantId,
  };
  const allowedProjectionIds = new Set(await membership.filterComponentKeys(checkerInput));
  const allowedCandidateCount = candidates.filter((candidate) =>
    allowedProjectionIds.has(candidate.projectionId),
  ).length;

  return {
    allowedProjectionIds,
    filteredCandidates: candidates.length - allowedCandidateCount,
  };
}

function assertDatabasePublishedReadScope({
  publicationId,
  requirePublishedSnapshot,
  tenantId,
}: {
  readonly publicationId: string | undefined;
  readonly requirePublishedSnapshot: boolean;
  readonly tenantId: string | undefined;
}): void {
  if (publicationId === undefined) {
    if (requirePublishedSnapshot) {
      throw new PublishedProjectionSnapshotRequiredError();
    }
    return;
  }

  requireNonEmptyPublishedScopeValue(publicationId, "publicationId");
  requireNonEmptyPublishedScopeValue(tenantId, "tenantId");
}

function assertPublishedPermissionScope(
  permissionScope: readonly string[] | undefined,
  required: boolean,
): void {
  if (required && permissionScope === undefined) {
    throw new PublishedProjectionPermissionScopeRequiredError();
  }
}

function requireNonEmptyPublishedScopeValue(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Hybrid retrieval published ${label} must be a non-empty string`);
  }

  return normalized;
}

function degradeRetrievalLeg({
  flag,
  flags,
  mode,
  reason,
  requiredMode,
}: {
  readonly flag: string;
  readonly flags: string[];
  readonly mode: string | undefined;
  readonly reason: unknown;
  readonly requiredMode: string;
}): { readonly durationMs: number; readonly value: RetrievalCandidate[] } {
  if (mode !== requiredMode) {
    throw reason;
  }

  flags.push(flag);

  return {
    durationMs: 0,
    value: [],
  };
}

async function timed<T>(
  now: () => number,
  fn: () => Promise<T>,
): Promise<{ readonly durationMs: number; readonly value: T }> {
  const startedAt = now();
  const value = await fn();

  return {
    durationMs: Math.max(0, now() - startedAt),
    value,
  };
}

function timedSync<T>(
  now: () => number,
  fn: () => T,
): { readonly durationMs: number; readonly value: T } {
  const startedAt = now();
  const value = fn();

  return {
    durationMs: Math.max(0, now() - startedAt),
    value,
  };
}
