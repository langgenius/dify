import { createHash, randomUUID } from "node:crypto";

import {
  type CacheAdapter,
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DocumentMultimodalItemSchema,
  KnowledgeSpaceObjectKeyPrefixSchema,
  type ListObjectsResult,
  type ObjectStorageAdapter,
} from "@knowledge/core";

import { optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { DeletionCleanupCapabilityUnavailableError } from "./deletion-residue-cleanup";
import {
  deleteHistoricalPublicationResiduePage,
  hasHistoricalPublicationResidue,
} from "./durable-deletion-publication-gc";
import type {
  DurableDeletionInventoryPage,
  DurableDeletionPrimaryDeleteInput,
  DurableDeletionTargetCapabilities,
  DurableDeletionTargetOperationInput,
} from "./durable-deletion-target-processors";
import { createDatabaseGraphIndexRepository } from "./graph-index-repository";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";
import {
  LegacySpaceCachePrefixes,
  knowledgeSpaceCacheNamespaces,
} from "./knowledge-space-cache-namespace";
import {
  deleteResearchTaskSpaceResiduePage,
  hasResearchTaskSpaceResidue,
} from "./research-task-deletion-cleanup";
import { createDatabaseRetrievalExecutionLeaseRepository } from "./retrieval-execution-lease";
import type { SourceSecretStore } from "./source-secret-store";

export interface DatabaseDurableDeletionTargetCapabilitiesOptions {
  readonly cache: CacheAdapter;
  readonly database: DatabaseAdapter;
  readonly generatePublicationId?: (() => string) | undefined;
  readonly objectStorage: ObjectStorageAdapter;
  readonly secretStore: Pick<SourceSecretStore, "delete">;
}

interface InventoryCursor {
  readonly activeDocumentId?: string | undefined;
  readonly databaseKeyCursor?: string | undefined;
  readonly documentAfter?: string | undefined;
  readonly documentScan?: "artifacts" | "manifests" | "raw" | "staged" | "storage" | undefined;
  readonly lifecycleCursor?: string | undefined;
  readonly manifestActiveId?: string | undefined;
  readonly manifestAfter?: string | undefined;
  readonly manifestKeyOffset?: number | undefined;
  readonly objectCursor?: string | undefined;
  readonly ordinal: number;
  readonly phase: "document_objects" | "lifecycle_secrets" | "source_secrets" | "space_objects";
  readonly sourceCursor?: string | undefined;
}

/**
 * Concrete production capabilities. Every DB mutation is tenant/space scoped, every external item
 * is inventoried before primary deletion, publication exclusion is a head CAS, and primary-row
 * deletion/proof run inside the repository's fenced completion transaction.
 */
export function createDatabaseDurableDeletionTargetCapabilities({
  cache,
  database,
  generatePublicationId = randomUUID,
  objectStorage,
  secretStore,
}: DatabaseDurableDeletionTargetCapabilitiesOptions): DurableDeletionTargetCapabilities {
  if (!cache.deletePrefix) {
    throw new DeletionCleanupCapabilityUnavailableError("cache.deletePrefix");
  }
  const deleteCachePrefix = cache.deletePrefix.bind(cache);
  const retrievalExecutionLeases = createDatabaseRetrievalExecutionLeaseRepository({ database });

  return {
    async quiesce({ job, signal }) {
      throwIfAborted(signal);
      await cancelScopedWork(database, job);
      const retrievalDrain = await retrievalExecutionLeases.drainExpiredForSpace({
        knowledgeSpaceId: job.knowledgeSpaceId,
        limit: 1_000,
        tenantId: job.tenantId,
      });
      const preservesDocuments = job.targetType === "source" && job.deleteMode === "keep";
      const probes = await Promise.all([
        retrievalDrain.hasExpiredRemaining || retrievalDrain.hasLive,
        preservesDocuments ? false : hasActiveCompilation(database, job),
        hasActiveResearch(database, job),
        hasActiveKnowledgeFsLease(database, job),
        hasActiveKnowledgeFsSessionLease(database, job),
        hasActiveMutationLease(database, job),
        hasActiveStagedCommit(database, job),
        preservesDocuments ? false : hasActiveLegacyBootstrap(database, job),
        preservesDocuments ? false : hasActivePageIndexBackfill(database, job),
        preservesDocuments ? false : hasActiveTidbFtsBackfill(database, job),
        hasActiveSourceCredentialBackfill(database, job),
        hasActiveSourceSync(database, job),
        hasActiveSourceProductWorkflow(database, job),
        hasPendingSourceConnectionSecretCleanup(database, job),
      ]);
      throwIfAborted(signal);
      return { drained: probes.every((active) => !active) };
    },

    async inventory({ cursor, job, limit, signal }) {
      throwIfAborted(signal);
      const state = decodeInventoryCursor(cursor, job);
      if (state.phase === "space_objects") {
        const prefix = await getSpaceObjectPrefix(database, job.tenantId, job.knowledgeSpaceId);
        const page = await objectStorage.listObjects({
          ...(state.objectCursor ? { cursor: state.objectCursor } : {}),
          limit,
          prefix: `${prefix}/`,
        });
        throwIfAborted(signal);
        const pageKeys = validateObjectStoragePage(page, state.objectCursor, `${prefix}/`, limit);
        const items = pageKeys.map((key, index) =>
          objectInventoryItem(key, state.ordinal + index, job.maxExecutionAttempts),
        );
        if (page.nextCursor) {
          return inventoryPage(items, false, {
            ...state,
            objectCursor: page.nextCursor,
            ordinal: state.ordinal + items.length,
          });
        }
        return inventoryPage(items, false, {
          ordinal: state.ordinal + items.length,
          phase: "lifecycle_secrets",
        });
      }

      if (state.phase === "document_objects") {
        const documentId =
          state.activeDocumentId ??
          (await nextTargetDocumentId(database, job, state.documentAfter));
        if (!documentId) {
          return job.targetType === "document_asset" || job.targetType === "logical_document"
            ? inventoryComplete(state.ordinal, "document_objects")
            : inventoryPage([], false, {
                ordinal: state.ordinal,
                phase: "lifecycle_secrets",
              });
        }
        const spacePrefix = await getSpaceObjectPrefix(
          database,
          job.tenantId,
          job.knowledgeSpaceId,
        );
        const scan = state.documentScan ?? "raw";
        if (scan === "storage") {
          const documentPrefix = `${spacePrefix}/documents/${documentId}/`;
          const page = await objectStorage.listObjects({
            ...(state.objectCursor ? { cursor: state.objectCursor } : {}),
            limit,
            prefix: documentPrefix,
          });
          throwIfAborted(signal);
          const pageKeys = validateObjectStoragePage(
            page,
            state.objectCursor,
            documentPrefix,
            limit,
          );
          const items = pageKeys.map((key, index) =>
            objectInventoryItem(key, state.ordinal + index, job.maxExecutionAttempts),
          );
          if (page.nextCursor) {
            return inventoryPage(items, false, {
              activeDocumentId: documentId,
              documentAfter: state.documentAfter,
              documentScan: "storage",
              objectCursor: page.nextCursor,
              ordinal: state.ordinal + items.length,
              phase: "document_objects",
            });
          }
          return inventoryPage(items, false, {
            documentAfter: documentId,
            documentScan: "raw",
            ordinal: state.ordinal + items.length,
            phase: "document_objects",
          });
        }

        if (scan === "manifests") {
          const manifestPage = await documentManifestObjectKeyPage(
            database,
            job,
            documentId,
            state,
            limit,
          );
          const pageKeys = validateObjectKeys(manifestPage.keys, `${spacePrefix}/`, limit);
          const items = pageKeys.map((key, index) =>
            objectInventoryItem(key, state.ordinal + index, job.maxExecutionAttempts),
          );
          return inventoryPage(items, false, {
            activeDocumentId: documentId,
            documentAfter: state.documentAfter,
            documentScan: manifestPage.complete ? "storage" : "manifests",
            ...(manifestPage.manifestActiveId
              ? { manifestActiveId: manifestPage.manifestActiveId }
              : {}),
            ...(manifestPage.manifestAfter ? { manifestAfter: manifestPage.manifestAfter } : {}),
            ...(manifestPage.manifestKeyOffset !== undefined
              ? { manifestKeyOffset: manifestPage.manifestKeyOffset }
              : {}),
            ordinal: state.ordinal + items.length,
            phase: "document_objects",
          });
        }

        const pageKeys = validateObjectKeys(
          await documentDatabaseObjectKeyPage(
            database,
            job,
            documentId,
            scan,
            state.databaseKeyCursor,
            limit,
          ),
          `${spacePrefix}/`,
          limit,
        );
        const items = pageKeys.map((key, index) =>
          objectInventoryItem(key, state.ordinal + index, job.maxExecutionAttempts),
        );
        if (pageKeys.length === limit) {
          const databaseKeyCursor = pageKeys.at(-1);
          if (!databaseKeyCursor || databaseKeyCursor === state.databaseKeyCursor) {
            throw new Error("Durable deletion database object cursor did not advance");
          }
          return inventoryPage(items, false, {
            activeDocumentId: documentId,
            databaseKeyCursor,
            documentAfter: state.documentAfter,
            documentScan: scan,
            ordinal: state.ordinal + items.length,
            phase: "document_objects",
          });
        }
        return inventoryPage(items, false, {
          activeDocumentId: documentId,
          documentAfter: state.documentAfter,
          documentScan: nextDocumentScan(scan),
          ordinal: state.ordinal + items.length,
          phase: "document_objects",
        });
      }

      if (state.phase === "lifecycle_secrets") {
        const secrets = await lifecycleSecretRefs(database, job, state.lifecycleCursor, limit);
        const items = secretInventoryItems(secrets, state.ordinal, job.maxExecutionAttempts);
        const last = secrets.at(-1);
        return last && secrets.length === limit
          ? inventoryPage(items, false, {
              lifecycleCursor: last.rowId,
              ordinal: state.ordinal + items.length,
              phase: "lifecycle_secrets",
            })
          : inventoryPage(items, false, {
              ordinal: state.ordinal + items.length,
              phase: "source_secrets",
            });
      }

      const secrets = await sourceSecretRefs(database, job, state.sourceCursor, limit);
      const items = secrets.map((source, index) => ({
        credentialRef: source.credentialRef,
        idempotencyKey: digestKey("secret", source.credentialRef),
        kind: "secret_ref" as const,
        maxAttempts: job.maxExecutionAttempts,
        ordinal: state.ordinal + index,
        resourceId: source.id,
      }));
      const last = secrets.at(-1);
      return last && secrets.length === limit
        ? inventoryPage(items, false, {
            ordinal: state.ordinal + items.length,
            phase: "source_secrets",
            sourceCursor: last.id,
          })
        : {
            complete: true,
            items,
            scanPhase: "source_secrets",
          };
    },

    async excludeTargetFromPublishedHead({ job, signal }) {
      throwIfAborted(signal);
      if (job.targetType === "source" && job.deleteMode === "keep") {
        await sanitizeSourceKeepPublishedHead(database, job, generatePublicationId);
      } else {
        await excludeFromPublishedHead(database, job, generatePublicationId);
      }
      throwIfAborted(signal);
    },

    async executeExternalItem({ item, job, signal }) {
      throwIfAborted(signal);
      switch (item.kind) {
        case "object":
          if (!item.objectKey) throw new Error("Durable deletion object item has no object key");
          validateObjectKeys(
            [item.objectKey],
            `${await getSpaceObjectPrefix(database, job.tenantId, job.knowledgeSpaceId)}/`,
            1,
          );
          await objectStorage.deleteObject(item.objectKey);
          break;
        case "secret_ref":
          if (!item.credentialRef || !item.resourceId) {
            throw new Error("Durable deletion secret item is incomplete");
          }
          await secretStore.delete({
            knowledgeSpaceId: job.knowledgeSpaceId,
            ref: item.credentialRef,
            sourceId: item.resourceId,
            tenantId: job.tenantId,
          });
          await markLifecycleSecretDeleted(database, job, {
            credentialRef: item.credentialRef,
            sourceId: item.resourceId,
          });
          break;
        case "cache_key":
          if (!item.cacheKey) throw new Error("Durable deletion cache item has no cache key");
          await cache.delete(item.cacheKey);
          break;
        case "document_cascade":
        case "document_detach":
          throw new Error(
            "Document primary actions must execute atomically in the fenced completion transaction",
          );
      }
      throwIfAborted(signal);
    },

    async deleteDerivedDataPage({ job, limit, signal }) {
      return database.transaction(async (transaction) => {
        await assertJobFence(database, transaction, job);
        const fencedDatabase = transactionBoundDatabase(database, transaction);
        const graph = createDatabaseGraphIndexRepository({
          database: fencedDatabase,
          maxBatchSize: 10_000,
        });
        throwIfAborted(signal);
        const preservesDocuments = job.targetType === "source" && job.deleteMode === "keep";
        try {
          // Command logs, KnowledgeFS session metadata, Golden Question metadata, and Research inputs
          // are opaque JSON. They cannot be attributed safely to one document/source, so every target
          // invalidates or removes the complete space-scoped history before primary identity removal.
          const retrievalLeaseHistoryDeleted = await deleteRetrievalExecutionLeaseHistoryPage(
            fencedDatabase,
            job,
            limit,
          );
          if (retrievalLeaseHistoryDeleted > 0) {
            return { complete: false, deleted: retrievalLeaseHistoryDeleted };
          }
          const resourceMountsDeleted = await deleteOpaqueResourceMountPage(
            fencedDatabase,
            job,
            limit,
          );
          if (resourceMountsDeleted > 0) {
            return { complete: false, deleted: resourceMountsDeleted };
          }
          const failedQueriesDeleted = await deleteOpaqueFailedQueryPage(
            fencedDatabase,
            job,
            limit,
          );
          if (failedQueriesDeleted > 0) {
            return { complete: false, deleted: failedQueriesDeleted };
          }
          const qualityResidueDeleted = await deleteQualityControlResiduePage(
            fencedDatabase,
            job,
            limit,
          );
          if (qualityResidueDeleted > 0) {
            return { complete: false, deleted: qualityResidueDeleted };
          }
          const workspaceSnapshotsDeleted = await deleteAgentWorkspaceSnapshotPage(
            fencedDatabase,
            job,
            limit,
          );
          if (workspaceSnapshotsDeleted > 0) {
            return { complete: false, deleted: workspaceSnapshotsDeleted };
          }
          const terminalTargetLeasesDeleted = await deleteTargetKnowledgeFsLeasePage(
            fencedDatabase,
            job,
            limit,
          );
          if (terminalTargetLeasesDeleted > 0) {
            return { complete: false, deleted: terminalTargetLeasesDeleted };
          }
          const knowledgeFsRowsDeleted = await deleteKnowledgeFsSpaceHistoryPage(
            fencedDatabase,
            job,
            limit,
          );
          if (knowledgeFsRowsDeleted > 0) {
            return { complete: false, deleted: knowledgeFsRowsDeleted };
          }
          const goldenQuestionsDeleted = await deleteGoldenQuestionPage(fencedDatabase, job, limit);
          if (goldenQuestionsDeleted > 0) {
            return { complete: false, deleted: goldenQuestionsDeleted };
          }
          const researchResidueDeleted = await deleteResearchTaskSpaceResiduePage(fencedDatabase, {
            knowledgeSpaceId: job.knowledgeSpaceId,
            limit,
            tenantId: job.tenantId,
          });
          if (researchResidueDeleted > 0) {
            return { complete: false, deleted: researchResidueDeleted };
          }
          const publicationResidueDeleted = await deleteTargetHistoricalPublicationPage(
            fencedDatabase,
            job,
            limit,
          );
          if (publicationResidueDeleted > 0) {
            return { complete: false, deleted: publicationResidueDeleted };
          }
          const sourceProductResidueDeleted = await deleteSourceProductResiduePage(
            fencedDatabase,
            job,
            limit,
          );
          if (sourceProductResidueDeleted > 0) {
            return { complete: false, deleted: sourceProductResidueDeleted };
          }
          const secretLedgerDeleted = await deleteCompletedSecretLifecyclePage(
            fencedDatabase,
            job,
            limit,
          );
          if (secretLedgerDeleted > 0) {
            return { complete: false, deleted: secretLedgerDeleted };
          }
          const overviewResidueDeleted = await deleteOverviewResiduePage(
            fencedDatabase,
            job,
            limit,
          );
          if (overviewResidueDeleted > 0) {
            return { complete: false, deleted: overviewResidueDeleted };
          }
          const directSourcePathsDeleted = await deleteDirectSourceKnowledgePathPage(
            fencedDatabase,
            job,
            limit,
          );
          if (directSourcePathsDeleted > 0) {
            return { complete: false, deleted: directSourcePathsDeleted };
          }
          if (preservesDocuments) {
            const documentMetadataScrubbed = await scrubRetainedDocumentSourceMetadataPage(
              fencedDatabase,
              job,
              limit,
            );
            if (documentMetadataScrubbed > 0) {
              return { complete: false, deleted: documentMetadataScrubbed };
            }
          }
          if (!preservesDocuments) {
            const tracesDeleted = await deleteAnswerTracePage(fencedDatabase, job, limit);
            if (tracesDeleted > 0) return { complete: false, deleted: tracesDeleted };
            const documentResidueDeleted = await deleteDocumentDerivedResiduePage(
              fencedDatabase,
              graph,
              job,
              limit,
            );
            if (documentResidueDeleted > 0) {
              return { complete: false, deleted: documentResidueDeleted };
            }
          }
          if (job.targetType === "knowledge_space") {
            const cascadeResidueDeleted = await deleteKnowledgeSpaceCascadeResiduePage(
              fencedDatabase,
              job,
              limit,
            );
            if (cascadeResidueDeleted > 0) {
              return { complete: false, deleted: cascadeResidueDeleted };
            }
          }

          // Source keep preserves document/Graph/trace rows, but source identity can be embedded in
          // path, session, retrieval, and context caches. Legacy digest-only namespaces cannot be
          // attributed safely, so they are conservatively drained before the exact v2 space scopes.
          const prefixes = [
            ...LegacySpaceCachePrefixes,
            ...knowledgeSpaceCacheNamespaces({
              knowledgeSpaceId: job.knowledgeSpaceId,
              tenantId: job.tenantId,
            }),
          ];
          for (const prefix of prefixes) {
            const result = await deleteCachePrefix({ limit, prefix });
            throwIfAborted(signal);
            if (
              !Number.isSafeInteger(result.deleted) ||
              result.deleted < 0 ||
              result.deleted > limit ||
              (result.nextCursor !== undefined && !result.nextCursor)
            ) {
              throw new Error("Durable deletion cache cleanup returned an invalid bounded page");
            }
            if (result.nextCursor && result.deleted === 0) {
              throw new Error("Durable deletion cache cleanup cursor made no deletion progress");
            }
            if (result.deleted > 0 || result.nextCursor) {
              return { complete: false, deleted: result.deleted };
            }
          }
          return { complete: true, deleted: 0 };
        } finally {
          // A cache/object adapter call can outlive the original lease. Recheck immediately before
          // commit so every DB page rolls back when the worker fence expired mid-operation.
          await assertJobFence(database, transaction, job);
        }
      });
    },

    deletePrimaryData: (input) => deleteAndProbePrimaryData(database, objectStorage, input),
  };
}

async function deleteCompletedSecretLifecyclePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType === "document_asset" || job.targetType === "logical_document") return 0;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, limit];
  let sourcePredicate = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    sourcePredicate = ` AND ${q("source_id")} = ${p(4)}`;
  }
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("source_secret_lifecycle_refs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("state")} = 'deleted'${sourcePredicate} ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "source_secret_lifecycle_refs",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "source_secret_lifecycle_refs", "id", ids);
  return ids.length;
}

/**
 * Removes the Source product's durable workflow hierarchy in bounded child-first pages. Source
 * deletion removes ordinary source workflows and bulk sync/disable parents. A bulk remove parent
 * is the durable observer of this deletion job and remains as bounded audit/progress state until
 * its own lifecycle expires; it stores the source id without a restrictive Source foreign key.
 */
async function deleteSourceProductResiduePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType !== "knowledge_space" && job.targetType !== "source") return 0;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const runParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  if (job.targetType === "source") runParams.push(job.targetId);
  const runScope = sourceWorkflowRunScopeSql(database, job, "target_run", 1, 2, 3);

  for (const table of ["source_workflow_outbox", "source_crawl_preview_pages"] as const) {
    const params = [...runParams, limit];
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: `SELECT child.${q("run_id")}, child.${q("id")} FROM ${q(table)} child WHERE child.${q("run_id")} IN (SELECT target_run.${q("id")} FROM ${q("source_workflow_runs")} target_run WHERE ${runScope}) ORDER BY child.${q("run_id")} ASC, child.${q("id")} ASC LIMIT ${p(params.length)} FOR UPDATE;`,
      tableName: table,
    });
    for (const row of rows.rows) {
      await database.execute({
        maxRows: 0,
        operation: "delete",
        params: [stringColumn(row, "run_id"), stringColumn(row, "id")],
        sql: `DELETE FROM ${q(table)} WHERE ${q("run_id")} = ${p(1)} AND ${q("id")} = ${p(2)};`,
        tableName: table,
      });
    }
    if (rows.rows.length > 0) return rows.rows.length;
  }

  if (job.targetType === "knowledge_space") {
    const bulkRows = await database.execute({
      maxRows: limit,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, limit],
      sql: `SELECT ${q("id")} FROM ${q("source_bulk_workflow_items")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: "source_bulk_workflow_items",
    });
    const bulkIds = bulkRows.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, database, "source_bulk_workflow_items", "id", bulkIds);
    if (bulkIds.length > 0) return bulkIds.length;
  }

  const runs = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [...runParams, limit],
    sql: `SELECT target_run.${q("id")} FROM ${q("source_workflow_runs")} target_run WHERE ${runScope} ORDER BY target_run.${q("id")} ASC LIMIT ${p(runParams.length + 1)} FOR UPDATE;`,
    tableName: "source_workflow_runs",
  });
  const runIds = runs.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "source_workflow_runs", "id", runIds);
  if (runIds.length > 0) return runIds.length;

  const policyParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  const policyTarget = job.targetType === "source" ? ` AND ${q("source_id")} = ${p(3)}` : "";
  if (job.targetType === "source") policyParams.push(job.targetId);
  const policies = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [...policyParams, limit],
    sql: `SELECT ${q("id")} FROM ${q("source_sync_policies")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${policyTarget} ORDER BY ${q("id")} ASC LIMIT ${p(policyParams.length + 1)} FOR UPDATE;`,
    tableName: "source_sync_policies",
  });
  const policyIds = policies.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "source_sync_policies", "id", policyIds);
  if (policyIds.length > 0) return policyIds.length;

  if (job.targetType === "knowledge_space") {
    const oauthRows = await database.execute({
      maxRows: limit,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, limit],
      sql: `SELECT ${q("id")} FROM ${q("source_oauth_transactions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: "source_oauth_transactions",
    });
    const oauthIds = oauthRows.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, database, "source_oauth_transactions", "id", oauthIds);
    if (oauthIds.length > 0) return oauthIds.length;

    const refs = await database.execute({
      maxRows: limit,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, limit],
      sql: `SELECT ${q("id")} FROM ${q("source_connection_secret_refs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("state")} = 'deleted' ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: "source_connection_secret_refs",
    });
    const refIds = refs.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, database, "source_connection_secret_refs", "id", refIds);
    if (refIds.length > 0) return refIds.length;
  }
  return 0;
}

function sourceWorkflowRunScopeSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  alias: string,
  tenantPosition: number,
  spacePosition: number,
  sourcePosition: number,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const base = `${alias}.${q("tenant_id")} = ${p(tenantPosition)} AND ${alias}.${q("knowledge_space_id")} = ${p(spacePosition)}`;
  if (job.targetType !== "source") return base;
  return `${base} AND (${alias}.${q("source_id")} = ${p(sourcePosition)} OR EXISTS (SELECT 1 FROM ${q("source_bulk_workflow_items")} target_bulk WHERE target_bulk.${q("run_id")} = ${alias}.${q("id")} AND target_bulk.${q("tenant_id")} = ${p(tenantPosition)} AND target_bulk.${q("knowledge_space_id")} = ${p(spacePosition)} AND target_bulk.${q("source_id")} = ${p(sourcePosition)} AND target_bulk.${q("action")} <> 'remove'))`;
}

async function deleteRetrievalExecutionLeaseHistoryPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("retrieval_execution_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${q("status")} <> 'active' OR ${q("expires_at")} <= CURRENT_TIMESTAMP) ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
    tableName: "retrieval_execution_leases",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "retrieval_execution_leases", "id", ids);
  return ids.length;
}

async function deleteOpaqueResourceMountPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("resource_mounts")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
    tableName: "resource_mounts",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "resource_mounts", "id", ids);
  return ids.length;
}

async function deleteOpaqueFailedQueryPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("failed_queries")} WHERE ${q("knowledge_space_id")} = ${p(1)} ORDER BY ${q("id")} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: "failed_queries",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "failed_queries", "id", ids);
  return ids.length;
}

/**
 * Quality replays freeze an entire publication/profile snapshot and their result JSON can carry
 * arbitrary evidence identifiers. A document/source deletion therefore cannot safely retain a
 * subset of a space's quality history. Drain the exact tenant-space closure child-first for every
 * target type, including source-keep, before deleting any referenced answer trace.
 */
async function deleteQualityControlResiduePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  for (const table of [
    "quality_resource_history",
    "quality_bad_cases",
    "quality_missing_evidence_reviews",
  ] as const) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, limit],
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: table,
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, database, table, "id", ids);
    if (ids.length > 0) return ids.length;
  }
  for (const table of ["quality_replay_items", "quality_replay_outbox"] as const) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, limit],
      sql: `SELECT child.${q("id")} FROM ${q(table)} child WHERE child.${q("run_id")} IN (SELECT run.${q("id")} FROM ${q("quality_replay_runs")} run WHERE run.${q("tenant_id")} = ${p(1)} AND run.${q("knowledge_space_id")} = ${p(2)}) ORDER BY child.${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: table,
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, database, table, "id", ids);
    if (ids.length > 0) return ids.length;
  }
  const runs = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("quality_replay_runs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
    tableName: "quality_replay_runs",
  });
  const runIds = runs.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "quality_replay_runs", "id", runIds);
  return runIds.length;
}

async function deleteOverviewResiduePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, limit];
  let targetPredicate = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    const source = `(${q("resource_type")} = 'source' AND ${q("resource_id")} = ${p(4)})`;
    targetPredicate =
      job.deleteMode === "keep"
        ? ` AND ${source}`
        : ` AND (${source} OR (${q("resource_type")} = 'document' AND ${q("resource_id")} IN (SELECT ${
            database.dialect === "postgres"
              ? `CAST(${q("id")} AS TEXT)`
              : `CAST(${q("id")} AS CHAR(36))`
          } FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(4)})))`;
  } else if (job.targetType === "logical_document") {
    params.push(job.targetId);
    targetPredicate = ` AND ${q("resource_type")} = 'document' AND ${q("resource_id")} = ${p(4)}`;
  } else if (job.targetType === "document_asset") {
    params.push(job.targetId);
    const logicalDocumentId =
      database.dialect === "postgres"
        ? `CAST(revision.${q("document_id")} AS TEXT)`
        : `CAST(revision.${q("document_id")} AS CHAR(36))`;
    targetPredicate = ` AND ${q("resource_type")} = 'document' AND ${q("resource_id")} IN (SELECT ${logicalDocumentId} FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(1)} AND revision.${q("knowledge_space_id")} = ${p(2)} AND revision.${q("document_asset_id")} = ${p(4)})`;
  }

  for (const table of [
    "knowledge_space_attention_states",
    "knowledge_space_activity_events",
  ] as const) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${targetPredicate} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
      tableName: table,
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    if (ids.length > 0) {
      await deleteIds(database, database, table, "id", ids);
      return ids.length;
    }
  }
  return 0;
}

async function hasOverviewResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  let targetPredicate = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    const source = `(${q("resource_type")} = 'source' AND ${q("resource_id")} = ${p(3)})`;
    targetPredicate =
      job.deleteMode === "keep"
        ? ` AND ${source}`
        : ` AND (${source} OR (${q("resource_type")} = 'document' AND ${q("resource_id")} IN (SELECT ${
            database.dialect === "postgres"
              ? `CAST(${q("id")} AS TEXT)`
              : `CAST(${q("id")} AS CHAR(36))`
          } FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(3)})))`;
  } else if (job.targetType === "logical_document") {
    params.push(job.targetId);
    targetPredicate = ` AND ${q("resource_type")} = 'document' AND ${q("resource_id")} = ${p(3)}`;
  } else if (job.targetType === "document_asset") {
    params.push(job.targetId);
    const logicalDocumentId =
      database.dialect === "postgres"
        ? `CAST(revision.${q("document_id")} AS TEXT)`
        : `CAST(revision.${q("document_id")} AS CHAR(36))`;
    targetPredicate = ` AND ${q("resource_type")} = 'document' AND ${q("resource_id")} IN (SELECT ${logicalDocumentId} FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(1)} AND revision.${q("knowledge_space_id")} = ${p(2)} AND revision.${q("document_asset_id")} = ${p(3)})`;
  }
  for (const table of [
    "knowledge_space_attention_states",
    "knowledge_space_activity_events",
  ] as const) {
    const residue = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${targetPredicate} LIMIT 1;`,
      tableName: table,
    });
    if (residue.rows.length > 0) return true;
  }
  return false;
}

async function deleteDirectSourceKnowledgePathPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType !== "source") return 0;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, job.targetId, limit],
    sql: `SELECT ${q("id")} FROM ${q("knowledge_paths")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ((${q("resource_type")} = 'source' AND ${q("target_id")} = ${p(2)}) OR ${q("virtual_path")} = CONCAT('/sources/', ${p(2)})) ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
    tableName: "knowledge_paths",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "knowledge_paths", "id", ids);
  return ids.length;
}

function sourceIdentityMetadataPredicateSql(
  database: DatabaseAdapter,
  metadata: string,
  includeSnapshots: boolean,
): string {
  if (database.dialect === "postgres") {
    const predicates = [
      `${metadata} ? 'sourceId'`,
      `${metadata} ? 'credentialRef'`,
      `(${metadata} -> 'fingerprintMaterial') ? 'sourceId'`,
      `(${metadata} -> 'projectionSetFingerprintMaterial') ? 'sourceId'`,
      `(${metadata} -> 'provenance') ? 'sourceId'`,
      `(${metadata} -> 'provenance') ? 'providerItemId'`,
    ];
    if (includeSnapshots) {
      predicates.push(
        `${metadata} ? 'sourceSnapshots'`,
        `(${metadata} -> 'fingerprintMaterial') ? 'sourceSnapshots'`,
        `(${metadata} -> 'projectionSetFingerprintMaterial') ? 'sourceSnapshots'`,
      );
    }
    return `(${predicates.join(" OR ")})`;
  }
  const paths = [
    "'$.sourceId'",
    "'$.credentialRef'",
    "'$.fingerprintMaterial.sourceId'",
    "'$.projectionSetFingerprintMaterial.sourceId'",
    "'$.provenance.sourceId'",
    "'$.provenance.providerItemId'",
    ...(includeSnapshots
      ? [
          "'$.sourceSnapshots'",
          "'$.fingerprintMaterial.sourceSnapshots'",
          "'$.projectionSetFingerprintMaterial.sourceSnapshots'",
        ]
      : []),
  ];
  return `JSON_CONTAINS_PATH(${metadata}, 'one', ${paths.join(", ")})`;
}

function scrubSourceIdentityMetadataSql(
  database: DatabaseAdapter,
  metadata: string,
  includeSnapshots: boolean,
): string {
  if (database.dialect === "postgres") {
    const root = `(${metadata} - 'sourceId' - 'credentialRef'${includeSnapshots ? " - 'sourceSnapshots'" : ""})`;
    const fingerprint = `${root} #- '{fingerprintMaterial,sourceId}'${includeSnapshots ? " #- '{fingerprintMaterial,sourceSnapshots}'" : ""}`;
    return `${fingerprint} #- '{projectionSetFingerprintMaterial,sourceId}' #- '{provenance,sourceId}' #- '{provenance,providerItemId}' #- '{provenance,remoteDeletionPolicy}'${includeSnapshots ? " #- '{projectionSetFingerprintMaterial,sourceSnapshots}'" : ""}`;
  }
  const paths = [
    "'$.sourceId'",
    "'$.credentialRef'",
    "'$.fingerprintMaterial.sourceId'",
    "'$.projectionSetFingerprintMaterial.sourceId'",
    "'$.provenance.sourceId'",
    "'$.provenance.providerItemId'",
    "'$.provenance.remoteDeletionPolicy'",
    ...(includeSnapshots
      ? [
          "'$.sourceSnapshots'",
          "'$.fingerprintMaterial.sourceSnapshots'",
          "'$.projectionSetFingerprintMaterial.sourceSnapshots'",
        ]
      : []),
  ];
  return `JSON_REMOVE(${metadata}, ${paths.join(", ")})`;
}

async function scrubRetainedDocumentSourceMetadataPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType !== "source" || job.deleteMode !== "keep") return 0;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const metadata = q("metadata");
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, job.targetId, limit],
    sql: `SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} AND ${sourceIdentityMetadataPredicateSql(database, metadata, false)} ORDER BY ${q("id")} ASC LIMIT ${p(3)} FOR UPDATE;`,
    tableName: "document_assets",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, index) => p(index + 1)).join(", ");
  await database.execute({
    maxRows: 0,
    operation: "update",
    params: ids,
    sql: `UPDATE ${q("document_assets")} SET ${metadata} = ${scrubSourceIdentityMetadataSql(database, metadata, false)}, ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = CURRENT_TIMESTAMP WHERE ${q("id")} IN (${placeholders});`,
    tableName: "document_assets",
  });
  return ids.length;
}

async function deleteKnowledgeSpaceCascadeResiduePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType !== "knowledge_space") return 0;

  for (const child of [
    {
      foreignKey: "attempt_id",
      parent: "document_compilation_attempts",
      table: "document_compilation_outbox",
    },
    { foreignKey: "trace_id", parent: "answer_traces", table: "answer_trace_steps" },
    { foreignKey: "manifest_id", parent: "page_index_manifests", table: "page_index_nodes" },
    {
      foreignKey: "research_task_job_id",
      parent: "research_task_jobs",
      table: "research_task_outbox",
    },
    { foreignKey: "run_id", parent: "quality_replay_runs", table: "quality_replay_items" },
    { foreignKey: "run_id", parent: "quality_replay_runs", table: "quality_replay_outbox" },
  ] as const) {
    const deleted = await deleteIndirectSpaceIdPage(database, job, limit, child);
    if (deleted > 0) return deleted;
  }

  for (const ledger of [
    {
      first: "bootstrap_id",
      parent: "legacy_space_publication_bootstraps",
      second: "document_asset_id",
      table: "legacy_space_publication_bootstrap_items",
    },
    {
      first: "backfill_id",
      parent: "page_index_upgrade_backfills",
      second: "document_outline_id",
      table: "page_index_upgrade_backfill_items",
    },
  ] as const) {
    const deleted = await deleteIndirectSpaceCompositePage(database, job, limit, ledger);
    if (deleted > 0) return deleted;
  }

  const memberRows = await selectSpacePublicationMemberPage(database, job, limit);
  if (memberRows.length > 0) {
    await deletePublicationMemberKeys(database, database, memberRows);
    return memberRows.length;
  }

  // Child-first order makes progress even when FK enforcement is temporarily disabled, while also
  // remaining valid with ordinary RESTRICT/CASCADE constraints enabled.
  for (const table of KnowledgeSpaceExplicitCleanupTables) {
    const deleted = await deleteSpaceIdTablePage(database, job, limit, table);
    if (deleted > 0) return deleted;
  }

  const parseArtifactsDeleted = await deleteSpaceParseArtifactPage(database, job, limit);
  if (parseArtifactsDeleted > 0) return parseArtifactsDeleted;
  return 0;
}

const KnowledgeSpaceExplicitCleanupTables = [
  "quality_resource_history",
  "quality_bad_cases",
  "quality_missing_evidence_reviews",
  "quality_replay_runs",
  "knowledge_space_activity_events",
  "knowledge_space_attention_states",
  "research_task_partial_results",
  "research_task_progress_events",
  "research_task_jobs",
  "document_compilation_attempts",
  "knowledge_space_profile_migration_runs",
  "legacy_space_publication_bootstraps",
  "page_index_upgrade_backfills",
  "page_index_terms",
  "page_index_manifests",
  "document_outlines",
  "index_projection_fts_postings",
  "projection_set_publication_heads",
  "graph_relations",
  "graph_entities",
  "index_projections",
  "knowledge_nodes",
  "artifact_segments",
  "document_multimodal_manifests",
  "knowledge_space_staged_commits",
  "knowledge_paths",
  "answer_traces",
  "evidence_bundles",
  "golden_questions",
  "failed_queries",
  "agent_workspace_snapshots",
  "knowledge_fs_leases",
  "knowledge_fs_sessions",
  "retrieval_execution_leases",
  "tidb_fts_posting_backfills",
  "knowledge_space_mutation_leases",
  "source_credential_backfills",
  "source_secret_lifecycle_refs",
  "resource_mounts",
  "knowledge_space_access_policy_members",
  "knowledge_space_access_policies",
  "knowledge_space_permission_snapshots",
  "knowledge_space_api_keys",
  "knowledge_space_api_access",
  "knowledge_space_members",
  "knowledge_space_profile_publication_bindings",
  "projection_set_publications",
] as const;

type KnowledgeSpaceExplicitCleanupTable = (typeof KnowledgeSpaceExplicitCleanupTables)[number];

async function deleteSpaceIdTablePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
  table: KnowledgeSpaceExplicitCleanupTable,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("knowledge_space_id")} = ${p(1)} ORDER BY ${q("id")} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: table,
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, table, "id", ids);
  return ids.length;
}

async function deleteIndirectSpaceIdPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
  input: { readonly foreignKey: string; readonly parent: string; readonly table: string },
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT child.${q("id")} FROM ${q(input.table)} AS child WHERE child.${q(input.foreignKey)} IN (SELECT parent.${q("id")} FROM ${q(input.parent)} AS parent WHERE parent.${q("knowledge_space_id")} = ${p(1)}) ORDER BY child.${q("id")} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: input.table,
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, input.table, "id", ids);
  return ids.length;
}

async function deleteIndirectSpaceCompositePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
  input: {
    readonly first: string;
    readonly parent: string;
    readonly second: string;
    readonly table: string;
  },
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT child.${q(input.first)}, child.${q(input.second)} FROM ${q(input.table)} AS child WHERE child.${q(input.first)} IN (SELECT parent.${q("id")} FROM ${q(input.parent)} AS parent WHERE parent.${q("knowledge_space_id")} = ${p(1)}) ORDER BY child.${q(input.first)} ASC, child.${q(input.second)} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: input.table,
  });
  const keys = rows.rows.map(
    (row) => [stringColumn(row, input.first), stringColumn(row, input.second)] as const,
  );
  await deleteCompositeIds(database, database, input.table, [input.first, input.second], keys);
  return keys.length;
}

interface PublicationMemberKey {
  readonly componentKey: string;
  readonly componentType: string;
  readonly publicationId: string;
}

async function selectSpacePublicationMemberPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<readonly PublicationMemberKey[]> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("publication_id")}, ${q("component_type")}, ${q("component_key")} FROM ${q("projection_set_publication_members")} WHERE ${q("knowledge_space_id")} = ${p(1)} ORDER BY ${q("publication_id")} ASC, ${q("component_type")} ASC, ${q("component_key")} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: "projection_set_publication_members",
  });
  return rows.rows.map((row) => ({
    componentKey: stringColumn(row, "component_key"),
    componentType: stringColumn(row, "component_type"),
    publicationId: stringColumn(row, "publication_id"),
  }));
}

async function deletePublicationMemberKeys(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  keys: readonly PublicationMemberKey[],
): Promise<void> {
  if (keys.length === 0) return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [];
  const predicates = keys.map((key) => {
    const publication = appendPlaceholders(database, params, [key.publicationId]);
    const type = appendPlaceholders(database, params, [key.componentType]);
    const component = appendPlaceholders(database, params, [key.componentKey]);
    return `(${q("publication_id")} = ${publication} AND ${q("component_type")} = ${type} AND ${q("component_key")} = ${component})`;
  });
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${q("projection_set_publication_members")} WHERE ${predicates.join(" OR ")};`,
    tableName: "projection_set_publication_members",
  });
}

async function deleteSpaceParseArtifactPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const rows = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.knowledgeSpaceId, limit],
    sql: `SELECT artifact.${q("id")} FROM ${q("parse_artifacts")} AS artifact WHERE artifact.${q("document_asset_id")} IN (SELECT document.${q("id")} FROM ${q("document_assets")} AS document WHERE document.${q("knowledge_space_id")} = ${p(1)}) ORDER BY artifact.${q("id")} ASC LIMIT ${p(2)} FOR UPDATE;`,
    tableName: "parse_artifacts",
  });
  const ids = rows.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "parse_artifacts", "id", ids);
  return ids.length;
}

async function deleteAgentWorkspaceSnapshotPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const active = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("agent_workspace_snapshots")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("invalidated_at")} IS NULL ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "agent_workspace_snapshots",
  });
  const activeIds = active.rows.map((row) => stringColumn(row, "id"));
  if (activeIds.length > 0) {
    const now = new Date().toISOString();
    const placeholders = activeIds.map((_, index) => p(index + 3)).join(", ");
    await database.execute({
      maxRows: 0,
      operation: "update",
      params: [now, "durable-deletion", ...activeIds],
      sql: `UPDATE ${q("agent_workspace_snapshots")} SET ${q("invalidated_at")} = ${p(1)}, ${q("invalidation_reason")} = ${p(2)} WHERE ${q("id")} IN (${placeholders}) AND ${q("invalidated_at")} IS NULL;`,
      tableName: "agent_workspace_snapshots",
    });
    return activeIds.length;
  }

  const invalidated = await database.execute({
    maxRows: limit,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId, limit],
    sql: `SELECT ${q("id")} FROM ${q("agent_workspace_snapshots")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("invalidated_at")} IS NOT NULL ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "agent_workspace_snapshots",
  });
  const invalidatedIds = invalidated.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "agent_workspace_snapshots", "id", invalidatedIds);
  return invalidatedIds.length;
}

async function deleteTargetKnowledgeFsLeasePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const alias = "target_lease";
  const params = targetKnowledgeFsLeaseParams(job);
  params.push(limit);
  const leases = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${alias}.${q("id")} FROM ${q("knowledge_fs_leases")} AS ${alias} WHERE ${targetKnowledgeFsLeasePredicateSql(database, job, alias)} AND (${alias}.${q("status")} <> 'active' OR ${alias}.${q("expires_at")} <= CURRENT_TIMESTAMP) ORDER BY ${alias}.${q("id")} ASC LIMIT ${p(params.length)};`,
    tableName: "knowledge_fs_leases",
  });
  const ids = leases.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "knowledge_fs_leases", "id", ids);
  return ids.length;
}

async function deleteKnowledgeFsSpaceHistoryPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, limit];
  const leases = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${q("status")} <> 'active' OR ${q("expires_at")} <= CURRENT_TIMESTAMP) ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "knowledge_fs_leases",
  });
  const leaseIds = leases.rows.map((row) => stringColumn(row, "id"));
  if (leaseIds.length > 0) {
    await deleteIds(database, database, "knowledge_fs_leases", "id", leaseIds);
    return leaseIds.length;
  }

  const remainingLease = await database.execute({
    maxRows: 1,
    operation: "select",
    params: params.slice(0, 2),
    sql: `SELECT ${q("id")} FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  if (remainingLease.rows.length > 0) {
    // An unexpired active lease must return the job to quiescing; never delete its session.
    return 0;
  }

  const sessions = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("knowledge_fs_sessions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "knowledge_fs_sessions",
  });
  const sessionIds = sessions.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "knowledge_fs_sessions", "id", sessionIds);
  return sessionIds.length;
}

const MaxDurableDeletionTargetDocuments = 100_000;

async function targetDocumentIdsForDeletion(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  executor: DatabaseExecutor = database,
): Promise<readonly string[]> {
  if (job.targetType === "knowledge_space") return [];
  if (job.targetType === "document_asset") return [job.targetId];
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: MaxDurableDeletionTargetDocuments + 1,
    operation: "select",
    params: [job.knowledgeSpaceId, job.targetId, MaxDurableDeletionTargetDocuments + 1],
    sql:
      job.targetType === "logical_document"
        ? `SELECT asset.${q("id")} FROM ${q("document_assets")} asset WHERE asset.${q("knowledge_space_id")} = ${p(1)} AND EXISTS (SELECT 1 FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${p(1)} AND owned_revision.${q("document_id")} = ${p(2)} AND owned_revision.${q("document_asset_id")} = asset.${q("id")}) AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${p(1)} AND external_revision.${q("document_id")} <> ${p(2)} AND external_revision.${q("document_asset_id")} = asset.${q("id")}) ORDER BY asset.${q("id")} ASC LIMIT ${p(3)};`
        : `SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} ORDER BY ${q("id")} ASC LIMIT ${p(3)};`,
    tableName: "document_assets",
  });
  if (result.rows.length > MaxDurableDeletionTargetDocuments) {
    throw new Error(
      `Durable deletion target documents exceed max=${MaxDurableDeletionTargetDocuments}`,
    );
  }
  return result.rows.map((row) => stringColumn(row, "id"));
}

async function deleteTargetHistoricalPublicationPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const documentAssetIds = await targetDocumentIdsForDeletion(database, job);
  if (documentAssetIds.length === 0) return 0;
  return deleteHistoricalPublicationResiduePage(database, {
    documentAssetIds,
    knowledgeSpaceId: job.knowledgeSpaceId,
    limit,
    maxDocumentAssetIds: MaxDurableDeletionTargetDocuments,
    tenantId: job.tenantId,
  });
}

async function cancelScopedWork(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  await database.transaction(async (transaction) => {
    await assertJobFence(database, transaction, job);
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, nowIso],
      sql: `UPDATE ${q("knowledge_fs_leases")} SET ${q("status")} = 'released', ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} = 'active' AND ${q("expires_at")} <= ${p(3)};`,
      tableName: "knowledge_fs_leases",
    });
    // Research/session/cache history is conservatively space-scoped for every target, including
    // source-keep. Drain those writers before its early return; only document/index writers may be
    // preserved by keep semantics.
    await cancelWholeSpaceOpaqueWriters(transaction, database, job, nowIso, nowMs);
    await cancelSourceProductWork(transaction, database, job, nowIso);
    if (job.targetType === "source" && job.deleteMode === "keep") {
      await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [job.knowledgeSpaceId, job.targetId, nowIso],
        sql: `UPDATE ${q("sources")} SET ${q("status")} = 'disabled', ${q("updated_at")} = ${p(3)}, ${q("version")} = ${q("version")} + 1 WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("status")} = 'syncing';`,
        tableName: "sources",
      });
      await cancelSourceCredentialBackfills(transaction, database, job, nowIso);
      return;
    }
    const compilationParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
    let compilationTarget = "";
    if (job.targetType === "document_asset") {
      compilationParams.push(job.targetId);
      compilationTarget = ` AND ${q("document_asset_id")} = ${p(3)}`;
    } else if (job.targetType === "source") {
      compilationParams.push(job.targetId);
      compilationTarget = ` AND ${q("document_asset_id")} IN (SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(3)})`;
    } else if (job.targetType === "logical_document") {
      compilationParams.push(job.targetId);
      compilationTarget = ` AND ${q("document_asset_id")} IN (SELECT owned_revision.${q("document_asset_id")} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("tenant_id")} = ${p(1)} AND owned_revision.${q("knowledge_space_id")} = ${p(2)} AND owned_revision.${q("document_id")} = ${p(3)})`;
    }
    const compilationNowPosition = compilationParams.length + 1;
    compilationParams.push(nowIso);
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: compilationParams,
      sql: `UPDATE ${q("document_compilation_attempts")} SET ${q("run_state")} = 'canceled', ${q("active_slot")} = NULL, ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("retry_at")} = NULL, ${q("completed_at")} = ${p(compilationNowPosition)}, ${q("updated_at")} = ${p(compilationNowPosition)}, ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${compilationTarget} AND (${q("run_state")} IN ('dispatch_pending', 'queued', 'retry_wait') OR (${q("run_state")} = 'running' AND ${q("lease_expires_at")} <= ${p(compilationNowPosition)}));`,
      tableName: "document_compilation_attempts",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: compilationParams,
      sql: `UPDATE ${q("document_compilation_outbox")} SET ${q("status")} = 'canceled', ${q("locked_by")} = NULL, ${q("lock_token")} = NULL, ${q("locked_until")} = NULL, ${q("updated_at")} = ${p(compilationNowPosition)} WHERE ${q("attempt_id")} IN (SELECT ${q("id")} FROM ${q("document_compilation_attempts")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${compilationTarget} AND ${q("run_state")} = 'canceled') AND ${q("status")} NOT IN ('completed', 'canceled', 'dead');`,
      tableName: "document_compilation_outbox",
    });

    // Research uses whole-space snapshots; privacy-first deletion drains all tasks in the space.
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, nowMs],
      sql: `UPDATE ${q("research_task_jobs")} SET ${q("stage")} = 'canceled', ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("retry_at")} = NULL, ${q("completed_at")} = ${p(3)}, ${q("updated_at")} = ${p(3)}, ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("stage")} NOT IN ('completed', 'failed', 'canceled') AND (${q("lease_token")} IS NULL OR ${q("lease_expires_at")} <= ${p(3)});`,
      tableName: "research_task_jobs",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, nowMs],
      sql: `UPDATE ${q("research_task_outbox")} SET ${q("status")} = 'canceled', ${q("locked_by")} = NULL, ${q("lock_token")} = NULL, ${q("locked_until")} = NULL, ${q("updated_at")} = ${p(3)} WHERE ${q("research_task_job_id")} IN (SELECT ${q("id")} FROM ${q("research_task_jobs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("stage")} = 'canceled') AND ${q("status")} NOT IN ('completed', 'canceled', 'dead');`,
      tableName: "research_task_outbox",
    });

    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, nowIso],
      sql: `UPDATE ${q("knowledge_space_staged_commits")} SET ${q("status")} = 'canceled', ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} NOT IN ('published', 'failed-terminal', 'canceled', 'gc-complete');`,
      tableName: "knowledge_space_staged_commits",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId, nowIso],
      sql: `DELETE FROM ${q("knowledge_space_mutation_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${q("expires_at")} IS NULL OR ${q("expires_at")} <= ${p(3)});`,
      tableName: "knowledge_space_mutation_leases",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params:
        job.targetType === "knowledge_space"
          ? [job.knowledgeSpaceId, nowIso]
          : [job.knowledgeSpaceId, job.targetId, nowIso],
      sql:
        job.targetType === "knowledge_space"
          ? `UPDATE ${q("sources")} SET ${q("status")} = 'disabled', ${q("updated_at")} = ${p(2)}, ${q("version")} = ${q("version")} + 1 WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("status")} = 'syncing';`
          : job.targetType === "source"
            ? `UPDATE ${q("sources")} SET ${q("status")} = 'disabled', ${q("updated_at")} = ${p(3)}, ${q("version")} = ${q("version")} + 1 WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("status")} = 'syncing';`
            : job.targetType === "logical_document"
              ? `UPDATE ${q("sources")} SET ${q("status")} = 'disabled', ${q("updated_at")} = ${p(3)}, ${q("version")} = ${q("version")} + 1 WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} IN (SELECT ${q("source_id")} FROM ${q("logical_documents")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("source_id")} IS NOT NULL) AND ${q("status")} = 'syncing';`
              : `UPDATE ${q("sources")} SET ${q("status")} = 'disabled', ${q("updated_at")} = ${p(3)}, ${q("version")} = ${q("version")} + 1 WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} IN (SELECT ${q("source_id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${q("source_id")} IS NOT NULL) AND ${q("status")} = 'syncing';`,
      tableName: "sources",
    });
    await cancelLegacyScopedWorkers(transaction, database, job, nowIso);
  });
}

async function cancelWholeSpaceOpaqueWriters(
  transaction: DatabaseExecutor,
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  nowIso: string,
  nowMs: number,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, nowMs],
    sql: `UPDATE ${q("research_task_jobs")} SET ${q("stage")} = 'canceled', ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("retry_at")} = NULL, ${q("completed_at")} = ${p(3)}, ${q("updated_at")} = ${p(3)}, ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("stage")} NOT IN ('completed', 'failed', 'canceled') AND (${q("lease_token")} IS NULL OR ${q("lease_expires_at")} <= ${p(3)});`,
    tableName: "research_task_jobs",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, nowMs],
    sql: `UPDATE ${q("research_task_outbox")} SET ${q("status")} = 'canceled', ${q("locked_by")} = NULL, ${q("lock_token")} = NULL, ${q("locked_until")} = NULL, ${q("updated_at")} = ${p(3)} WHERE ${q("research_task_job_id")} IN (SELECT ${q("id")} FROM ${q("research_task_jobs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("stage")} = 'canceled') AND ${q("status")} NOT IN ('completed', 'canceled', 'dead');`,
    tableName: "research_task_outbox",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, nowIso],
    sql: `UPDATE ${q("knowledge_space_staged_commits")} SET ${q("status")} = 'canceled', ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} NOT IN ('published', 'failed-terminal', 'canceled', 'gc-complete');`,
    tableName: "knowledge_space_staged_commits",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "delete",
    params: [job.tenantId, job.knowledgeSpaceId, nowIso],
    sql: `DELETE FROM ${q("knowledge_space_mutation_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${q("expires_at")} IS NULL OR ${q("expires_at")} <= ${p(3)});`,
    tableName: "knowledge_space_mutation_leases",
  });
}

async function cancelLegacyScopedWorkers(
  transaction: DatabaseExecutor,
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  now: string,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  for (const worker of [
    {
      terminalState: "canceled",
      table: "legacy_space_publication_bootstraps",
    },
    {
      terminalState: "superseded",
      table: "page_index_upgrade_backfills",
    },
    {
      terminalState: "failed",
      table: "tidb_fts_posting_backfills",
    },
  ] as const) {
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, now],
      sql: `UPDATE ${q(worker.table)} SET ${q("run_state")} = '${worker.terminalState}', ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("completed_at")} = ${p(3)}, ${q("updated_at")} = ${p(3)}, ${q("last_error_code")} = 'DURABLE_DELETION_FENCE', ${q("last_error_message")} = 'Canceled by durable deletion', ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${q("run_state")} = 'queued' OR (${q("run_state")} = 'running' AND ${q("lease_expires_at")} <= ${p(3)}));`,
      tableName: worker.table,
    });
  }
  await cancelSourceCredentialBackfills(transaction, database, job, now);
}

async function cancelSourceCredentialBackfills(
  transaction: DatabaseExecutor,
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  now: string,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  let target = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} = ${p(3)}`;
  } else if (job.targetType === "document_asset") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} IN (SELECT ${q("source_id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("source_id")} IS NOT NULL)`;
  } else if (job.targetType === "logical_document") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} IN (SELECT ${q("source_id")} FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("source_id")} IS NOT NULL)`;
  }
  const nowPosition = params.length + 1;
  params.push(now);
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q("source_credential_backfills")} SET ${q("run_state")} = 'failed', ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("completed_at")} = ${p(nowPosition)}, ${q("updated_at")} = ${p(nowPosition)}, ${q("last_error_code")} = 'DURABLE_DELETION_FENCE', ${q("last_error_message")} = 'Canceled by durable deletion', ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${target} AND (${q("run_state")} = 'queued' OR (${q("run_state")} = 'running' AND ${q("lease_expires_at")} <= ${p(nowPosition)}));`,
    tableName: "source_credential_backfills",
  });
}

async function cancelSourceProductWork(
  transaction: DatabaseExecutor,
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  now: string,
): Promise<void> {
  if (job.targetType !== "knowledge_space" && job.targetType !== "source") return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  if (job.targetType === "source") params.push(job.targetId);
  const runScope = sourceWorkflowRunScopeSql(database, job, "source_workflow_runs", 1, 2, 3);
  const nowPosition = params.length + 1;
  params.push(now);
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q("source_workflow_runs")} SET ${q("run_state")} = 'canceled', ${q("active_slot")} = NULL, ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("completed_at")} = ${p(nowPosition)}, ${q("canceled_at")} = ${p(nowPosition)}, ${q("updated_at")} = ${p(nowPosition)}, ${q("last_error_code")} = 'DURABLE_DELETION_FENCE', ${q("last_error_message")} = 'Canceled by durable deletion', ${q("row_version")} = ${q("row_version")} + 1 WHERE ${runScope} AND (${q("run_state")} IN ('queued', 'preview_ready') OR (${q("run_state")} IN ('running', 'crawling', 'importing', 'syncing') AND ${q("lease_expires_at")} <= ${p(nowPosition)}));`,
    tableName: "source_workflow_runs",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q("source_workflow_outbox")} SET ${q("status")} = 'canceled', ${q("locked_by")} = NULL, ${q("lock_token")} = NULL, ${q("locked_until")} = NULL, ${q("updated_at")} = ${p(nowPosition)} WHERE ${q("run_id")} IN (SELECT ${q("id")} FROM ${q("source_workflow_runs")} WHERE ${runScope} AND ${q("run_state")} = 'canceled') AND ${q("status")} NOT IN ('completed', 'canceled');`,
    tableName: "source_workflow_outbox",
  });

  if (job.targetType !== "knowledge_space") return;
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, now],
    sql: `UPDATE ${q("source_oauth_transactions")} SET ${q("status")} = 'failed', ${q("consumed_at")} = COALESCE(${q("consumed_at")}, ${p(3)}) WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} IN ('pending', 'exchanging');`,
    tableName: "source_oauth_transactions",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, now],
    sql: `UPDATE ${q("source_connection_secret_refs")} SET ${q("state")} = 'retired', ${q("remote_revoke_required")} = CASE WHEN ${q("remote_revoke_required")} THEN TRUE WHEN ${q("purpose")} = 'connection-credential' AND EXISTS (SELECT 1 FROM ${q("source_connections")} source_connection WHERE source_connection.${q("id")} = ${q("source_connection_secret_refs")}.${q("connection_id")} AND source_connection.${q("tenant_id")} = ${p(1)} AND source_connection.${q("knowledge_space_id")} = ${p(2)} AND source_connection.${q("auth_kind")} = 'oauth2') THEN TRUE ELSE FALSE END, ${q("recover_after")} = ${p(3)}, ${q("next_attempt_at")} = NULL, ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("state")} IN ('staged', 'active', 'retired');`,
    tableName: "source_connection_secret_refs",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [job.tenantId, job.knowledgeSpaceId, now],
    sql: `UPDATE ${q("source_connections")} SET ${q("status")} = 'revoked', ${q("credential_ref")} = NULL, ${q("expires_at")} = NULL, ${q("version")} = ${q("version")} + 1, ${q("updated_at")} = ${p(3)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} <> 'revoked';`,
    tableName: "source_connections",
  });
}

async function deleteAndProbePrimaryData(
  database: DatabaseAdapter,
  objectStorage: ObjectStorageAdapter,
  { job, leaseFence, signal, transaction }: DurableDeletionPrimaryDeleteInput,
): Promise<{ readonly clean: boolean }> {
  throwIfAborted(signal);
  if (
    leaseFence.deletionJobId !== job.id ||
    leaseFence.expectedRowVersion !== job.rowVersion ||
    leaseFence.leaseToken !== job.leaseToken
  ) {
    throw new Error("Durable deletion primary adapter received a mismatched lease fence");
  }
  if (await hasForbiddenDerivedResidue(database, transaction, job)) {
    return { clean: false };
  }
  if (await hasFinalObjectResidue(database, transaction, objectStorage, job)) {
    return { clean: false };
  }
  await assertJobFence(database, transaction, job);
  await cleanupLogicalDocumentsForPrimaryDeletion(database, transaction, job);
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  if (job.targetType === "document_asset") {
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.targetId, job.knowledgeSpaceId, job.id],
      sql: `DELETE FROM ${q("document_assets")} WHERE ${q("id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("deletion_job_id")} = ${p(3)};`,
      tableName: "document_assets",
    });
  } else if (job.targetType === "logical_document") {
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.knowledgeSpaceId, job.id],
      sql: `DELETE FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("deletion_job_id")} = ${p(2)};`,
      tableName: "document_assets",
    });
  } else if (job.targetType === "source") {
    if (job.deleteMode === "cascade") {
      await transaction.execute({
        maxRows: 0,
        operation: "delete",
        params: [job.knowledgeSpaceId, job.targetId, job.id],
        sql: `DELETE FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} AND (${q("deletion_job_id")} IS NULL OR ${q("deletion_job_id")} = ${p(3)});`,
        tableName: "document_assets",
      });
    } else {
      // Restore only children fenced by this source-keep job. A document linked to an independent
      // deletion job stays hidden and keeps the source residue probe dirty.
      await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [job.knowledgeSpaceId, job.targetId, job.id, job.updatedAt],
        sql: `UPDATE ${q("document_assets")} SET ${q("source_id")} = NULL, ${q("lifecycle_state")} = 'active', ${q("deletion_job_id")} = NULL, ${q("deleting_at")} = NULL, ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = ${p(4)} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} AND ${q("deletion_job_id")} = ${p(3)};`,
        tableName: "document_assets",
      });
      // A writer that started before the fence may have committed an unfenced child. Detach it as
      // part of keep semantics; rows owned by another deletion job are deliberately excluded.
      await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [job.knowledgeSpaceId, job.targetId, job.updatedAt],
        sql: `UPDATE ${q("document_assets")} SET ${q("source_id")} = NULL, ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = ${p(3)} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} AND ${q("deletion_job_id")} IS NULL;`,
        tableName: "document_assets",
      });
    }
    const childResidue = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId, job.targetId],
      sql: `SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} LIMIT 1;`,
      tableName: "document_assets",
    });
    if (childResidue.rows.length > 0) return { clean: false };
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.targetId, job.knowledgeSpaceId, job.id],
      sql: `DELETE FROM ${q("sources")} WHERE ${q("id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("deletion_job_id")} = ${p(3)};`,
      tableName: "sources",
    });
  } else {
    // Do not rely on FK cascades for the primary hierarchy: operators may temporarily disable
    // them during recovery, and the final residue proof must still be deterministic.
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)};`,
      tableName: "document_assets",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("sources")} WHERE ${q("knowledge_space_id")} = ${p(1)};`,
      tableName: "sources",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("source_oauth_transactions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "source_oauth_transactions",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("source_connections")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "source_connections",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_profile_migration_runs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_profile_migration_runs",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_profile_backfills")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_profile_backfills",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_profile_publication_bindings")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_profile_publication_bindings",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_profile_heads")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_profile_heads",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_profile_revisions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_profile_revisions",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `DELETE FROM ${q("knowledge_space_manifests")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)};`,
      tableName: "knowledge_space_manifests",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [job.targetId, job.tenantId, job.id],
      sql: `DELETE FROM ${q("knowledge_spaces")} WHERE ${q("id")} = ${p(1)} AND ${q("tenant_id")} = ${p(2)} AND ${q("deletion_job_id")} = ${p(3)};`,
      tableName: "knowledge_spaces",
    });
  }
  throwIfAborted(signal);
  if (job.targetType === "logical_document") {
    const logicalResidue = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId, job.targetId, job.id],
      sql: `SELECT document.${q("id")} FROM ${q("logical_documents")} document WHERE document.${q("tenant_id")} = ${p(1)} AND document.${q("knowledge_space_id")} = ${p(2)} AND document.${q("id")} = ${p(3)} UNION ALL SELECT revision.${q("document_id")} AS ${q("id")} FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(1)} AND revision.${q("knowledge_space_id")} = ${p(2)} AND revision.${q("document_id")} = ${p(3)} UNION ALL SELECT asset.${q("id")} FROM ${q("document_assets")} asset WHERE asset.${q("knowledge_space_id")} = ${p(2)} AND asset.${q("deletion_job_id")} = ${p(4)} LIMIT 1;`,
      tableName: "logical_documents",
    });
    return { clean: logicalResidue.rows.length === 0 };
  }
  const residue = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params:
      job.targetType === "knowledge_space"
        ? [job.targetId, job.tenantId]
        : [job.targetId, job.knowledgeSpaceId],
    sql:
      job.targetType === "knowledge_space"
        ? `SELECT ${q("id")} FROM ${q("knowledge_spaces")} WHERE ${q("id")} = ${p(1)} AND ${q("tenant_id")} = ${p(2)} LIMIT 1;`
        : `SELECT ${q("id")} FROM ${q(job.targetType === "source" ? "sources" : "document_assets")} WHERE ${q("id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName:
      job.targetType === "knowledge_space"
        ? "knowledge_spaces"
        : job.targetType === "source"
          ? "sources"
          : "document_assets",
  });
  if (residue.rows.length > 0) return { clean: false };
  if (
    job.targetType === "knowledge_space" &&
    (await hasKnowledgeSpaceCascadeResidue(database, transaction, job.knowledgeSpaceId))
  ) {
    return { clean: false };
  }
  return { clean: true };
}

async function cleanupLogicalDocumentsForPrimaryDeletion(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  if (job.targetType === "document_asset") {
    // The compatibility asset route deletes only the physical version. If it is currently active,
    // leave the logical aggregate visible as failed/no-active-revision; aggregate erasure uses the
    // dedicated logical_document target and inventories every exclusively-owned asset.
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.updatedAt, job.tenantId, job.knowledgeSpaceId, job.targetId],
      sql: `UPDATE ${q("logical_documents")} SET ${q("active_revision")} = NULL, ${q("status")} = 'failed', ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = ${p(1)} WHERE ${q("tenant_id")} = ${p(2)} AND ${q("knowledge_space_id")} = ${p(3)} AND EXISTS (SELECT 1 FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(2)} AND revision.${q("knowledge_space_id")} = ${p(3)} AND revision.${q("document_id")} = ${q("logical_documents")}.${q("id")} AND revision.${q("revision")} = ${q("logical_documents")}.${q("active_revision")} AND revision.${q("document_asset_id")} = ${p(4)});`,
      tableName: "logical_documents",
    });
    const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, job.targetId];
    const revisionScope = `(${q("document_id")}, ${q("document_revision")}) IN (SELECT revision.${q("document_id")}, revision.${q("revision")} FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(1)} AND revision.${q("knowledge_space_id")} = ${p(2)} AND revision.${q("document_asset_id")} = ${p(3)})`;
    for (const mutation of [
      {
        predicate: revisionScope,
        table: "document_reindex_attempts",
      },
      {
        predicate: revisionScope,
        table: "document_chunk_state_changes",
      },
      {
        predicate: `(${q("document_id")}, ${q("document_revision")}) IN (SELECT revision.${q("document_id")}, revision.${q("revision")} FROM ${q("document_revisions")} revision WHERE revision.${q("tenant_id")} = ${p(1)} AND revision.${q("knowledge_space_id")} = ${p(2)} AND revision.${q("document_asset_id")} = ${p(3)})`,
        table: "document_revision_chunks",
      },
    ] as const) {
      await transaction.execute({
        maxRows: 0,
        operation: "delete",
        params,
        sql: `DELETE FROM ${q(mutation.table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${mutation.predicate};`,
        tableName: mutation.table,
      });
    }
    // Remove an unpublished aggregate only while its target-asset revisions are still available
    // as an exact SQL fence. Active/superseded history, a different asset, or any activated row
    // keeps the parent. Deleting the parent cascades only these failed/candidate target revisions.
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params,
      sql: `DELETE FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("active_revision")} IS NULL AND EXISTS (SELECT 1 FROM ${q("document_revisions")} target_revision WHERE target_revision.${q("tenant_id")} = ${p(1)} AND target_revision.${q("knowledge_space_id")} = ${p(2)} AND target_revision.${q("document_id")} = ${q("logical_documents")}.${q("id")} AND target_revision.${q("document_asset_id")} = ${p(3)}) AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} retained_revision WHERE retained_revision.${q("tenant_id")} = ${p(1)} AND retained_revision.${q("knowledge_space_id")} = ${p(2)} AND retained_revision.${q("document_id")} = ${q("logical_documents")}.${q("id")} AND (retained_revision.${q("document_asset_id")} <> ${p(3)} OR retained_revision.${q("state")} NOT IN ('candidate', 'failed') OR retained_revision.${q("activated_at")} IS NOT NULL));`,
      tableName: "logical_documents",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params,
      sql: `DELETE FROM ${q("document_revisions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_asset_id")} = ${p(3)};`,
      tableName: "document_revisions",
    });
    return;
  }
  if (job.targetType === "source") {
    if (job.deleteMode === "cascade") {
      await cleanupLogicalDocumentAggregateRows(database, transaction, job, "source");
      return;
    }
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, job.targetId],
      sql: `UPDATE ${q("document_revisions")} SET ${q("system_metadata")} = ${scrubSourceIdentityMetadataSql(database, q("system_metadata"), false)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_id")} IN (SELECT ${q("id")} FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(3)});`,
      tableName: "document_revisions",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [job.tenantId, job.knowledgeSpaceId, job.targetId, job.updatedAt],
      sql: `UPDATE ${q("logical_documents")} SET ${q("source_id")} = NULL, ${q("provider_item_id")} = NULL, ${q("system_metadata")} = ${scrubSourceIdentityMetadataSql(database, q("system_metadata"), false)}, ${q("row_version")} = ${q("row_version")} + 1, ${q("updated_at")} = ${p(4)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(3)};`,
      tableName: "logical_documents",
    });
    return;
  }
  await cleanupLogicalDocumentAggregateRows(
    database,
    transaction,
    job,
    job.targetType === "logical_document" ? "logical_document" : "knowledge_space",
  );
}

async function cleanupLogicalDocumentAggregateRows(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
  scope: "knowledge_space" | "logical_document" | "source",
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  if (scope !== "knowledge_space") params.push(job.targetId);
  const documentPredicate = (column: string) =>
    scope === "knowledge_space"
      ? ""
      : scope === "logical_document"
        ? ` AND ${column} = ${p(3)}`
        : ` AND ${column} IN (SELECT source_document.${q("id")} FROM ${q("logical_documents")} source_document WHERE source_document.${q("tenant_id")} = ${p(1)} AND source_document.${q("knowledge_space_id")} = ${p(2)} AND source_document.${q("source_id")} = ${p(3)})`;

  // Break TiDB's circular active-revision RESTRICT edge before deleting either side.
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q("logical_documents")} SET ${q("active_revision")} = NULL WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${documentPredicate(q("id"))};`,
    tableName: "logical_documents",
  });

  for (const child of [
    { documentColumn: q("document_id"), table: "document_reindex_attempts" },
    { documentColumn: q("document_id"), table: "document_chunk_state_changes" },
    { documentColumn: q("document_id"), table: "document_revision_chunks" },
    { documentColumn: q("document_id"), table: "document_settings_heads" },
    { documentColumn: q("document_id"), table: "document_settings_revisions" },
    { documentColumn: q("document_id"), table: "document_revisions" },
  ] as const) {
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params,
      sql: `DELETE FROM ${q(child.table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${documentPredicate(child.documentColumn)};`,
      tableName: child.table,
    });
  }
  await transaction.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${documentPredicate(q("id"))};`,
    tableName: "logical_documents",
  });
}

async function hasFinalObjectResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  objectStorage: ObjectStorageAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  // Source cascades can own a very large number of documents. Their durable inventory runs only
  // after mutation/compilation leases drain and scans every document prefix; all source writers
  // are deletion-fenced. Repeating that scan while the completion transaction holds row locks
  // would turn one source into unbounded external I/O. Space/document targets each have one bounded
  // final prefix and are re-probed below.
  if (job.targetType === "source") return false;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const manifest = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q("object_key_prefix")} FROM ${q("knowledge_space_manifests")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName: "knowledge_space_manifests",
  });
  const row = manifest.rows[0];
  if (!row)
    throw new Error("Knowledge space object prefix is unavailable for final deletion proof");
  const spacePrefix = KnowledgeSpaceObjectKeyPrefixSchema.parse(
    stringColumn(row, "object_key_prefix"),
  );
  if (job.targetType === "knowledge_space") {
    const page = await objectStorage.listObjects({ limit: 1, prefix: `${spacePrefix}/` });
    validateObjectStoragePage(page, undefined, `${spacePrefix}/`, 1);
    return page.objects.length > 0;
  }

  const documentParams: DatabaseQueryValue[] = [job.knowledgeSpaceId];
  const documentTarget =
    job.targetType === "logical_document"
      ? ` AND ${q("deletion_job_id")} = ${p(2)}`
      : ` AND ${q("id")} = ${p(2)}`;
  documentParams.push(job.targetType === "logical_document" ? job.id : job.targetId);
  if (job.targetType === "logical_document") {
    documentParams.push(MaxDurableDeletionTargetDocuments + 1);
  }
  const documents = await executor.execute({
    maxRows: job.targetType === "logical_document" ? MaxDurableDeletionTargetDocuments + 1 : 2,
    operation: "select",
    params: documentParams,
    sql: `SELECT ${q("id")}, ${q("object_key")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)}${documentTarget} ORDER BY ${q("id")} ASC LIMIT ${job.targetType === "logical_document" ? p(3) : "2"};`,
    tableName: "document_assets",
  });
  if (
    job.targetType === "logical_document" &&
    documents.rows.length > MaxDurableDeletionTargetDocuments
  ) {
    throw new Error(
      `Logical document deletion assets exceed max=${MaxDurableDeletionTargetDocuments}`,
    );
  }
  if (job.targetType !== "logical_document" && documents.rows.length > 1) {
    throw new Error("Durable deletion document object proof escaped its single-document scope");
  }
  for (const document of documents.rows) {
    const documentId = stringColumn(document, "id");
    const prefix = `${spacePrefix}/documents/${documentId}/`;
    const page = await objectStorage.listObjects({ limit: 1, prefix });
    validateObjectStoragePage(page, undefined, prefix, 1);
    if (page.objects.length > 0) return true;
    const rawObjectKey = stringColumn(document, "object_key");
    if (await objectStorage.headObject(rawObjectKey)) return true;
  }
  return false;
}

const KnowledgeSpaceCascadeProbeTables = [
  "quality_resource_history",
  "quality_bad_cases",
  "quality_missing_evidence_reviews",
  "quality_replay_runs",
  "knowledge_space_activity_events",
  "knowledge_space_attention_states",
  "knowledge_space_manifests",
  "knowledge_space_profile_migration_runs",
  "knowledge_space_profile_backfills",
  "knowledge_space_profile_publication_bindings",
  "knowledge_space_profile_heads",
  "knowledge_space_profile_revisions",
  "source_connections",
  "source_oauth_transactions",
  "source_connection_secret_refs",
  "sources",
  "source_sync_policies",
  "source_workflow_runs",
  "source_bulk_workflow_items",
  "source_credential_backfills",
  "source_secret_lifecycle_refs",
  "resource_mounts",
  "logical_documents",
  "document_revisions",
  "document_revision_chunks",
  "document_chunk_state_changes",
  "document_settings_revisions",
  "document_settings_heads",
  "document_reindex_attempts",
  "document_assets",
  "document_multimodal_manifests",
  "artifact_segments",
  "knowledge_space_staged_commits",
  "knowledge_fs_sessions",
  "knowledge_fs_leases",
  "retrieval_execution_leases",
  "knowledge_nodes",
  "index_projections",
  "index_projection_fts_postings",
  "tidb_fts_posting_backfills",
  "projection_set_publications",
  "projection_set_publication_heads",
  "projection_set_publication_members",
  "document_compilation_attempts",
  "legacy_space_publication_bootstraps",
  "knowledge_space_mutation_leases",
  "page_index_upgrade_backfills",
  "knowledge_paths",
  "evidence_bundles",
  "golden_questions",
  "answer_traces",
  "graph_entities",
  "graph_relations",
  "failed_queries",
  "document_outlines",
  "page_index_manifests",
  "page_index_terms",
  "knowledge_space_members",
  "knowledge_space_access_policies",
  "knowledge_space_access_policy_members",
  "knowledge_space_api_access",
  "knowledge_space_api_keys",
  "knowledge_space_permission_snapshots",
  "agent_workspace_snapshots",
  "research_task_jobs",
  "research_task_partial_results",
  "research_task_progress_events",
] as const;

async function hasKnowledgeSpaceCascadeResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  knowledgeSpaceId: string,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = databasePlaceholder(database, 1);
  for (const childTable of ["source_workflow_outbox", "source_crawl_preview_pages"] as const) {
    const child = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [knowledgeSpaceId],
      sql: `SELECT child.${q("id")} FROM ${q(childTable)} child INNER JOIN ${q("source_workflow_runs")} parent ON parent.${q("id")} = child.${q("run_id")} WHERE parent.${q("knowledge_space_id")} = ${p} LIMIT 1;`,
      tableName: childTable,
    });
    if (child.rows.length > 0) return true;
  }
  for (const childTable of ["quality_replay_items", "quality_replay_outbox"] as const) {
    const child = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [knowledgeSpaceId],
      sql: `SELECT child.${q("id")} FROM ${q(childTable)} child INNER JOIN ${q("quality_replay_runs")} parent ON parent.${q("id")} = child.${q("run_id")} WHERE parent.${q("knowledge_space_id")} = ${p} LIMIT 1;`,
      tableName: childTable,
    });
    if (child.rows.length > 0) return true;
  }
  for (const table of KnowledgeSpaceCascadeProbeTables) {
    const residue = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [knowledgeSpaceId],
      sql: `SELECT 1 AS ${q("residue")} FROM ${q(table)} WHERE ${q("knowledge_space_id")} = ${p} LIMIT 1;`,
      tableName: table,
    });
    if (residue.rows.length > 0) return true;
  }
  return false;
}

async function excludeFromPublishedHead(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  generatePublicationId: () => string,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  await database.transaction(async (transaction) => {
    await assertJobFence(database, transaction, job);
    const head = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `SELECT h.${q("publication_id")}, h.${q("head_revision")}, p.${q("fingerprint")}, p.${q("projection_version")} FROM ${q("projection_set_publication_heads")} h INNER JOIN ${q("projection_set_publications")} p ON p.${q("id")} = h.${q("publication_id")} AND p.${q("tenant_id")} = h.${q("tenant_id")} AND p.${q("knowledge_space_id")} = h.${q("knowledge_space_id")} WHERE h.${q("tenant_id")} = ${p(1)} AND h.${q("knowledge_space_id")} = ${p(2)} FOR UPDATE;`,
      tableName: "projection_set_publication_heads",
    });
    const row = head.rows[0];
    if (!row) return;
    const oldPublicationId = stringColumn(row, "publication_id");
    const fingerprint = deletionPublicationFingerprint(job.id, oldPublicationId);
    if (!(await publishedHeadContainsTarget(database, transaction, job, oldPublicationId))) return;

    const publicationId = generatePublicationId();
    const now = new Date().toISOString();
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [
        publicationId,
        job.tenantId,
        job.knowledgeSpaceId,
        fingerprint,
        numericColumn(row, "projection_version"),
        "published",
        JSON.stringify({ deletionJobId: job.id, excludesTarget: true }),
        now,
      ],
      sql: `INSERT INTO ${q("projection_set_publications")} (${["id", "tenant_id", "knowledge_space_id", "fingerprint", "projection_version", "status", "metadata", "created_at", "updated_at"].map(q).join(", ")}) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${jsonInsertPlaceholder(database, 7, "metadata")}, ${p(8)}, ${p(8)});`,
      tableName: "projection_set_publications",
    });
    const exclusion = publicationExclusionSql(database, job, oldPublicationId);
    await copyDeletionPublicationMembers(
      database,
      transaction,
      publicationId,
      exclusion.params,
      exclusion.predicate,
    );
    await copyActivatedPublicationProfileBinding(database, transaction, {
      fingerprint,
      knowledgeSpaceId: job.knowledgeSpaceId,
      now,
      sourcePublicationId: oldPublicationId,
      targetPublicationId: publicationId,
      tenantId: job.tenantId,
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [fingerprint, now, oldPublicationId, job.tenantId, job.knowledgeSpaceId],
      sql: `UPDATE ${q("projection_set_publications")} SET ${q("status")} = 'superseded', ${q("superseded_by_fingerprint")} = ${p(1)}, ${q("updated_at")} = ${p(2)} WHERE ${q("id")} = ${p(3)} AND ${q("tenant_id")} = ${p(4)} AND ${q("knowledge_space_id")} = ${p(5)} AND ${q("status")} = 'published';`,
      tableName: "projection_set_publications",
    });
    const advanced = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        publicationId,
        now,
        job.tenantId,
        job.knowledgeSpaceId,
        numericColumn(row, "head_revision"),
      ],
      sql: `UPDATE ${q("projection_set_publication_heads")} SET ${q("publication_id")} = ${p(1)}, ${q("head_revision")} = ${q("head_revision")} + 1, ${q("updated_at")} = ${p(2)} WHERE ${q("tenant_id")} = ${p(3)} AND ${q("knowledge_space_id")} = ${p(4)} AND ${q("head_revision")} = ${p(5)};`,
      tableName: "projection_set_publication_heads",
    });
    if (advanced.rowsAffected !== 1) throw new Error("Durable deletion publication head CAS lost");
    if (await publishedHeadContainsTarget(database, transaction, job, publicationId)) {
      throw new Error("Durable deletion publication exclusion residual probe failed");
    }
    if (
      await publishedHeadHasInvalidGraphClosure(
        database,
        transaction,
        job.tenantId,
        job.knowledgeSpaceId,
        publicationId,
      )
    ) {
      throw new Error("Durable deletion publication graph closure residual probe failed");
    }
    await assertJobFence(database, transaction, job);
  });
}

async function sanitizeSourceKeepPublishedHead(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  generatePublicationId: () => string,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  await database.transaction(async (transaction) => {
    await assertJobFence(database, transaction, job);
    const head = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `SELECT h.${q("publication_id")}, h.${q("head_revision")}, p.${q("fingerprint")}, p.${q("projection_version")}, p.${q("metadata")} FROM ${q("projection_set_publication_heads")} AS h INNER JOIN ${q("projection_set_publications")} AS p ON p.${q("id")} = h.${q("publication_id")} AND p.${q("tenant_id")} = h.${q("tenant_id")} AND p.${q("knowledge_space_id")} = h.${q("knowledge_space_id")} WHERE h.${q("tenant_id")} = ${p(1)} AND h.${q("knowledge_space_id")} = ${p(2)} FOR UPDATE;`,
      tableName: "projection_set_publication_heads",
    });
    const row = head.rows[0];
    if (!row) return;
    const oldPublicationId = stringColumn(row, "publication_id");
    const currentMetadata = jsonObjectColumn(row, "metadata");
    if (
      currentMetadata.deletionJobId === job.id &&
      currentMetadata.sourceIdentityScrubbed === true
    ) {
      return;
    }
    const fingerprint = deletionPublicationFingerprint(job.id, oldPublicationId);
    const publicationId = generatePublicationId();
    const now = new Date().toISOString();
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [
        publicationId,
        job.tenantId,
        job.knowledgeSpaceId,
        fingerprint,
        numericColumn(row, "projection_version"),
        "published",
        JSON.stringify({
          deletionJobId: job.id,
          retainedDocuments: true,
          sourceIdentityScrubbed: true,
        }),
        now,
      ],
      sql: `INSERT INTO ${q("projection_set_publications")} (${["id", "tenant_id", "knowledge_space_id", "fingerprint", "projection_version", "status", "metadata", "created_at", "updated_at"].map(q).join(", ")}) VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${jsonInsertPlaceholder(database, 7, "metadata")}, ${p(8)}, ${p(8)});`,
      tableName: "projection_set_publications",
    });
    await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [publicationId, oldPublicationId, job.tenantId, job.knowledgeSpaceId],
      sql: `INSERT INTO ${q("projection_set_publication_members")} (${["tenant_id", "knowledge_space_id", "publication_id", "component_type", "component_key", "generation_id", "document_asset_id", "created_at"].map(q).join(", ")}) SELECT source_member.${q("tenant_id")}, source_member.${q("knowledge_space_id")}, ${p(1)}, source_member.${q("component_type")}, source_member.${q("component_key")}, source_member.${q("generation_id")}, source_member.${q("document_asset_id")}, source_member.${q("created_at")} FROM ${q("projection_set_publication_members")} AS source_member WHERE source_member.${q("publication_id")} = ${p(2)} AND source_member.${q("tenant_id")} = ${p(3)} AND source_member.${q("knowledge_space_id")} = ${p(4)};`,
      tableName: "projection_set_publication_members",
    });
    await copyActivatedPublicationProfileBinding(database, transaction, {
      fingerprint,
      knowledgeSpaceId: job.knowledgeSpaceId,
      now,
      sourcePublicationId: oldPublicationId,
      targetPublicationId: publicationId,
      tenantId: job.tenantId,
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [fingerprint, now, oldPublicationId, job.tenantId, job.knowledgeSpaceId],
      sql: `UPDATE ${q("projection_set_publications")} SET ${q("status")} = 'superseded', ${q("superseded_by_fingerprint")} = ${p(1)}, ${q("updated_at")} = ${p(2)} WHERE ${q("id")} = ${p(3)} AND ${q("tenant_id")} = ${p(4)} AND ${q("knowledge_space_id")} = ${p(5)} AND ${q("status")} = 'published';`,
      tableName: "projection_set_publications",
    });
    const advanced = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        publicationId,
        now,
        job.tenantId,
        job.knowledgeSpaceId,
        numericColumn(row, "head_revision"),
      ],
      sql: `UPDATE ${q("projection_set_publication_heads")} SET ${q("publication_id")} = ${p(1)}, ${q("head_revision")} = ${q("head_revision")} + 1, ${q("updated_at")} = ${p(2)} WHERE ${q("tenant_id")} = ${p(3)} AND ${q("knowledge_space_id")} = ${p(4)} AND ${q("head_revision")} = ${p(5)};`,
      tableName: "projection_set_publication_heads",
    });
    if (advanced.rowsAffected !== 1) {
      throw new Error("Durable deletion source-keep publication head CAS lost");
    }
    await assertJobFence(database, transaction, job);
  });
}

async function copyActivatedPublicationProfileBinding(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly fingerprint: string;
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly sourcePublicationId: string;
    readonly targetPublicationId: string;
    readonly tenantId: string;
  },
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "changed_kind",
    "binding_reason",
    "embedding_profile_kind",
    "embedding_profile_revision_id",
    "embedding_profile_revision",
    "embedding_profile_snapshot_digest",
    "retrieval_profile_kind",
    "retrieval_profile_revision_id",
    "retrieval_profile_revision",
    "retrieval_profile_snapshot_digest",
    "vector_space_id",
    "publication_id",
    "publication_fingerprint",
    "created_at",
    "activated_at",
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: [
      input.targetPublicationId,
      input.fingerprint,
      input.now,
      input.tenantId,
      input.knowledgeSpaceId,
      input.sourcePublicationId,
    ],
    sql: `INSERT INTO ${q("knowledge_space_profile_publication_bindings")} (${columns
      .map(q)
      .join(", ")}) SELECT ${p(1)}, source_binding.${q("tenant_id")}, source_binding.${q(
      "knowledge_space_id",
    )}, 'content', 'content-publication', source_binding.${q(
      "embedding_profile_kind",
    )}, source_binding.${q("embedding_profile_revision_id")}, source_binding.${q(
      "embedding_profile_revision",
    )}, source_binding.${q("embedding_profile_snapshot_digest")}, source_binding.${q(
      "retrieval_profile_kind",
    )}, source_binding.${q("retrieval_profile_revision_id")}, source_binding.${q(
      "retrieval_profile_revision",
    )}, source_binding.${q("retrieval_profile_snapshot_digest")}, source_binding.${q(
      "vector_space_id",
    )}, ${p(1)}, ${p(2)}, ${p(3)}, ${p(3)} FROM ${q(
      "knowledge_space_profile_publication_bindings",
    )} source_binding WHERE source_binding.${q("tenant_id")} = ${p(
      4,
    )} AND source_binding.${q("knowledge_space_id")} = ${p(
      5,
    )} AND source_binding.${q("publication_id")} = ${p(
      6,
    )} AND source_binding.${q("activated_at")} IS NOT NULL;`,
    tableName: "knowledge_space_profile_publication_bindings",
  });
  if (result.rowsAffected !== 1) {
    throw new Error(
      "Durable deletion successor publication requires one activated profile binding",
    );
  }
}

async function copyDeletionPublicationMembers(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  publicationId: string,
  exclusionParams: readonly DatabaseQueryValue[],
  documentExclusionPredicate: string,
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const sourceMember = "source_member";
  const columns = [
    "tenant_id",
    "knowledge_space_id",
    "publication_id",
    "component_type",
    "component_key",
    "generation_id",
    "document_asset_id",
    "created_at",
  ];
  const selectedColumns = [
    `${sourceMember}.${q("tenant_id")}`,
    `${sourceMember}.${q("knowledge_space_id")}`,
    p(1),
    `${sourceMember}.${q("component_type")}`,
    `${sourceMember}.${q("component_key")}`,
    `${sourceMember}.${q("generation_id")}`,
    `${sourceMember}.${q("document_asset_id")}`,
    `${sourceMember}.${q("created_at")}`,
  ];
  const params = [publicationId, ...exclusionParams];
  const commonWhere = `${sourceMember}.${q("publication_id")} = ${p(2)} AND ${sourceMember}.${q("tenant_id")} = ${p(3)} AND ${sourceMember}.${q("knowledge_space_id")} = ${p(4)} AND ${documentExclusionPredicate}`;
  const insertPrefix = `INSERT INTO ${q("projection_set_publication_members")} (${columns.map(q).join(", ")}) SELECT ${selectedColumns.join(", ")} FROM ${q("projection_set_publication_members")} AS ${sourceMember}`;

  // Copy ordinary document components first. Graph closure validation below resolves source-node
  // projections against this new immutable publication, never against a mutable current head.
  await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insertPrefix} WHERE ${commonWhere} AND ${sourceMember}.${q("component_type")} NOT IN ('graph-entity', 'graph-relation');`,
    tableName: "projection_set_publication_members",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insertPrefix} WHERE ${commonWhere} AND ${sourceMember}.${q("component_type")} = 'graph-entity' AND ${graphEntityMemberClosureSql(database, sourceMember, p(1))};`,
    tableName: "projection_set_publication_members",
  });
  await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insertPrefix} WHERE ${commonWhere} AND ${sourceMember}.${q("component_type")} = 'graph-relation' AND ${graphRelationMemberClosureSql(database, sourceMember, p(1))};`,
    tableName: "projection_set_publication_members",
  });
}

function graphEntityMemberClosureSql(
  database: DatabaseAdapter,
  memberAlias: string,
  visiblePublicationIdSql: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const componentAlias = "candidate_graph_entity";
  return `EXISTS (SELECT 1 FROM ${q("graph_entities")} AS ${componentAlias} WHERE ${graphComponentMemberJoinSql(database, componentAlias, memberAlias)} AND ${graphSourceNodePublicationClosureSql(database, componentAlias, memberAlias, visiblePublicationIdSql)})`;
}

function graphRelationMemberClosureSql(
  database: DatabaseAdapter,
  memberAlias: string,
  visiblePublicationIdSql: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const componentAlias = "candidate_graph_relation";
  const endpointMemberExists = (
    column: "object_entity_id" | "subject_entity_id",
    suffix: string,
  ) => {
    const endpointMember = `${suffix}_entity_member`;
    const endpointEntity = `${suffix}_entity`;
    return `EXISTS (SELECT 1 FROM ${q("projection_set_publication_members")} AS ${endpointMember} INNER JOIN ${q("graph_entities")} AS ${endpointEntity} ON ${graphComponentMemberJoinSql(database, endpointEntity, endpointMember)} WHERE ${endpointMember}.${q("tenant_id")} = ${memberAlias}.${q("tenant_id")} AND ${endpointMember}.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} AND ${endpointMember}.${q("publication_id")} = ${visiblePublicationIdSql} AND ${endpointMember}.${q("component_type")} = 'graph-entity' AND ${endpointMember}.${q("component_key")} = ${componentAlias}.${q(column)})`;
  };
  return `EXISTS (SELECT 1 FROM ${q("graph_relations")} AS ${componentAlias} WHERE ${graphComponentMemberJoinSql(database, componentAlias, memberAlias)} AND ${graphSourceNodePublicationClosureSql(database, componentAlias, memberAlias, visiblePublicationIdSql)} AND ${endpointMemberExists("subject_entity_id", "subject")} AND ${endpointMemberExists("object_entity_id", "object")})`;
}

function graphComponentMemberJoinSql(
  database: DatabaseAdapter,
  componentAlias: string,
  memberAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return `${componentAlias}.${q("id")} = ${memberAlias}.${q("component_key")} AND ${componentAlias}.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} AND ${componentAlias}.${q("publication_generation_id")} = ${memberAlias}.${q("generation_id")}`;
}

function graphSourceNodePublicationClosureSql(
  database: DatabaseAdapter,
  componentAlias: string,
  memberAlias: string,
  visiblePublicationIdSql: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const sourceNodeIds = `${componentAlias}.${q("source_node_ids")}`;
  const sourceRows =
    database.dialect === "postgres"
      ? `jsonb_array_elements_text(${sourceNodeIds}) AS source_ref(node_id)`
      : `JSON_TABLE(${sourceNodeIds}, '$[*]' COLUMNS (node_id VARCHAR(255) PATH '$')) AS source_ref`;
  const sourceNodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(source_node_row.${q("id")} AS TEXT) = source_ref.node_id`
      : `CAST(source_node_row.${q("id")} AS CHAR(36)) = source_ref.node_id`;
  const sourceLength =
    database.dialect === "postgres"
      ? `jsonb_array_length(${sourceNodeIds})`
      : `JSON_LENGTH(${sourceNodeIds})`;
  const visibleProjection = `EXISTS (SELECT 1 FROM ${q("projection_set_publication_members")} AS visible_projection_member INNER JOIN ${q("index_projections")} AS visible_projection ON visible_projection.${q("id")} = visible_projection_member.${q("component_key")} AND visible_projection.${q("knowledge_space_id")} = visible_projection_member.${q("knowledge_space_id")} AND visible_projection.${q("publication_generation_id")} = visible_projection_member.${q("generation_id")} WHERE visible_projection_member.${q("tenant_id")} = ${memberAlias}.${q("tenant_id")} AND visible_projection_member.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} AND visible_projection_member.${q("publication_id")} = ${visiblePublicationIdSql} AND visible_projection_member.${q("component_type")} = 'index-projection' AND visible_projection_member.${q("generation_id")} = ${memberAlias}.${q("generation_id")} AND visible_projection_member.${q("document_asset_id")} = ${memberAlias}.${q("document_asset_id")} AND visible_projection.${q("node_id")} = source_node_row.${q("id")} AND visible_projection.${q("status")} = 'ready')`;
  const sourceNodeExists = `EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS source_node_row WHERE source_node_row.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} AND source_node_row.${q("publication_generation_id")} = ${memberAlias}.${q("generation_id")} AND source_node_row.${q("document_asset_id")} = ${memberAlias}.${q("document_asset_id")} AND ${sourceNodeIdMatch} AND ${visibleProjection})`;
  const activeOwner = `EXISTS (SELECT 1 FROM ${q("document_assets")} AS graph_owner_document WHERE graph_owner_document.${q("id")} = ${memberAlias}.${q("document_asset_id")} AND graph_owner_document.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} AND graph_owner_document.${q("lifecycle_state")} = 'active')`;
  return `${memberAlias}.${q("document_asset_id")} IS NOT NULL AND ${activeOwner} AND ${sourceLength} > 0 AND NOT EXISTS (SELECT 1 FROM ${sourceRows} WHERE NOT (${sourceNodeExists}))`;
}

function publicationExclusionSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  publicationId: string,
): { readonly params: readonly DatabaseQueryValue[]; readonly predicate: string } {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const member = "source_member";
  const documentAssetId = `${member}.${q("document_asset_id")}`;
  const params: DatabaseQueryValue[] = [publicationId, job.tenantId, job.knowledgeSpaceId];
  if (job.targetType === "knowledge_space") return { params, predicate: "1 = 0" };
  if (job.targetType === "document_asset") {
    params.push(job.targetId);
    return {
      params,
      predicate: `(${documentAssetId} IS NULL OR ${documentAssetId} <> ${p(5)})`,
    };
  }
  params.push(job.targetId);
  if (job.targetType === "logical_document") {
    return {
      params,
      predicate: `(${documentAssetId} IS NULL OR ${documentAssetId} NOT IN (SELECT owned_revision.${q("document_asset_id")} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${p(4)} AND owned_revision.${q("document_id")} = ${p(5)} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${p(4)} AND external_revision.${q("document_id")} <> ${p(5)} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")})))`,
    };
  }
  return {
    params,
    predicate: `(${documentAssetId} IS NULL OR ${documentAssetId} NOT IN (SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(4)} AND ${q("source_id")} = ${p(5)}))`,
  };
}

async function publishedHeadContainsTarget(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
  publicationId: string,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const memberAlias = "target_member";
  const params: DatabaseQueryValue[] = [publicationId, job.tenantId, job.knowledgeSpaceId];
  let directDocumentPredicate = "1 = 1";
  if (job.targetType === "document_asset") {
    params.push(job.targetId);
    directDocumentPredicate = `${memberAlias}.${q("document_asset_id")} = ${p(4)}`;
  } else if (job.targetType === "source") {
    params.push(job.targetId);
    directDocumentPredicate = `${memberAlias}.${q("document_asset_id")} IN (SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(3)} AND ${q("source_id")} = ${p(4)})`;
  } else if (job.targetType === "logical_document") {
    params.push(job.targetId);
    directDocumentPredicate = `${memberAlias}.${q("document_asset_id")} IN (SELECT owned_revision.${q("document_asset_id")} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${p(3)} AND owned_revision.${q("document_id")} = ${p(4)} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${p(3)} AND external_revision.${q("document_id")} <> ${p(4)} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")}))`;
  }
  const graphTargetPredicate =
    job.targetType === "knowledge_space"
      ? ""
      : ` OR ${graphMemberReferencesTargetDocumentSql(database, job, memberAlias, "graph_entities", "graph-entity")} OR ${graphMemberReferencesTargetDocumentSql(database, job, memberAlias, "graph_relations", "graph-relation")}`;
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${memberAlias}.${q("component_key")} FROM ${q("projection_set_publication_members")} AS ${memberAlias} WHERE ${memberAlias}.${q("publication_id")} = ${p(1)} AND ${memberAlias}.${q("tenant_id")} = ${p(2)} AND ${memberAlias}.${q("knowledge_space_id")} = ${p(3)} AND (${directDocumentPredicate}${graphTargetPredicate}) LIMIT 1;`,
    tableName: "projection_set_publication_members",
  });
  return result.rows.length > 0;
}

function graphMemberReferencesTargetDocumentSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  memberAlias: string,
  table: "graph_entities" | "graph_relations",
  componentType: "graph-entity" | "graph-relation",
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const graphAlias = `target_${componentType.replace("-", "_")}`;
  const sourceRows =
    database.dialect === "postgres"
      ? `${q(table)} AS ${graphAlias} CROSS JOIN LATERAL jsonb_array_elements_text(${graphAlias}.${q("source_node_ids")}) AS target_source_ref(node_id)`
      : `${q(table)} AS ${graphAlias} INNER JOIN JSON_TABLE(${graphAlias}.${q("source_node_ids")}, '$[*]' COLUMNS (node_id VARCHAR(255) PATH '$')) AS target_source_ref ON TRUE`;
  const sourceNodeMatch =
    database.dialect === "postgres"
      ? `CAST(target_source_node.${q("id")} AS TEXT) = target_source_ref.node_id`
      : `CAST(target_source_node.${q("id")} AS CHAR(36)) = target_source_ref.node_id`;
  const targetDocumentPredicate =
    job.targetType === "document_asset"
      ? `target_source_node.${q("document_asset_id")} = ${p(4)}`
      : job.targetType === "logical_document"
        ? `target_source_node.${q("document_asset_id")} IN (SELECT owned_revision.${q("document_asset_id")} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${p(3)} AND owned_revision.${q("document_id")} = ${p(4)} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${p(3)} AND external_revision.${q("document_id")} <> ${p(4)} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")}))`
        : `target_source_node.${q("document_asset_id")} IN (SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(3)} AND ${q("source_id")} = ${p(4)})`;
  return `(${memberAlias}.${q("component_type")} = '${componentType}' AND EXISTS (SELECT 1 FROM ${sourceRows} INNER JOIN ${q("knowledge_nodes")} AS target_source_node ON ${sourceNodeMatch} AND target_source_node.${q("knowledge_space_id")} = ${memberAlias}.${q("knowledge_space_id")} WHERE ${graphComponentMemberJoinSql(database, graphAlias, memberAlias)} AND ${targetDocumentPredicate}))`;
}

async function publishedHeadHasInvalidGraphClosure(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
  publicationId: string,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const memberAlias = "validated_graph_member";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [publicationId, tenantId, knowledgeSpaceId],
    sql: `SELECT ${memberAlias}.${q("component_key")} FROM ${q("projection_set_publication_members")} AS ${memberAlias} WHERE ${memberAlias}.${q("publication_id")} = ${p(1)} AND ${memberAlias}.${q("tenant_id")} = ${p(2)} AND ${memberAlias}.${q("knowledge_space_id")} = ${p(3)} AND ((${memberAlias}.${q("component_type")} = 'graph-entity' AND NOT (${graphEntityMemberClosureSql(database, memberAlias, p(1))})) OR (${memberAlias}.${q("component_type")} = 'graph-relation' AND NOT (${graphRelationMemberClosureSql(database, memberAlias, p(1))}))) LIMIT 1;`,
    tableName: "projection_set_publication_members",
  });
  return result.rows.length > 0;
}

async function assertJobFence(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<void> {
  if (!job.leaseToken) throw new Error("Durable deletion job has no lease token");
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const currentTime =
    database.dialect === "postgres" ? "clock_timestamp()" : "CURRENT_TIMESTAMP(3)";
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id, job.rowVersion, job.leaseToken],
    sql: `SELECT ${q("id")} FROM ${q("deletion_jobs")} WHERE ${q("id")} = ${p(1)} AND ${q("row_version")} = ${p(2)} AND ${q("lease_token")} = ${p(3)} AND ${q("run_state")} = 'running' AND ${q("lease_expires_at")} > ${currentTime} FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  if (result.rows.length !== 1) throw new Error("Durable deletion publication lease fence lost");
}

function transactionBoundDatabase(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
): DatabaseAdapter {
  return {
    ...database,
    execute: (input) => transaction.execute(input),
    transaction: async (callback) => callback(transaction),
  };
}

async function nextTargetDocumentId(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  cursor: string | undefined,
): Promise<string | undefined> {
  if (job.targetType === "document_asset") return cursor ? undefined : job.targetId;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId, cursor ?? ""];
  let target = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} = ${p(3)}`;
  } else if (job.targetType === "logical_document") {
    params.push(job.id);
    target = ` AND ${q("deletion_job_id")} = ${p(3)}`;
  }
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("id")} > ${p(2)}${target} ORDER BY ${q("id")} ASC LIMIT 1;`,
    tableName: "document_assets",
  });
  return result.rows[0] ? stringColumn(result.rows[0], "id") : undefined;
}

interface DocumentManifestObjectKeyPage {
  readonly complete: boolean;
  readonly keys: readonly string[];
  readonly manifestActiveId?: string | undefined;
  readonly manifestAfter?: string | undefined;
  readonly manifestKeyOffset?: number | undefined;
}

async function documentManifestObjectKeyPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  documentId: string,
  state: InventoryCursor,
  limit: number,
): Promise<DocumentManifestObjectKeyPage> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const activeId = state.manifestActiveId;
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, documentId];
  let cursorPredicate: string;
  if (activeId) {
    params.push(activeId);
    cursorPredicate = ` AND manifest.${q("id")} = ${p(4)}`;
  } else {
    params.push(state.manifestAfter ?? "");
    cursorPredicate = ` AND manifest.${q("id")} > ${p(4)}`;
  }
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT manifest.${q("id")}, manifest.${q("items")} FROM ${q("document_multimodal_manifests")} manifest WHERE manifest.${q("knowledge_space_id")} = ${p(2)} AND manifest.${q("document_asset_id")} = ${p(3)}${cursorPredicate} AND EXISTS (SELECT 1 FROM ${q("knowledge_spaces")} scope_space WHERE scope_space.${q("tenant_id")} = ${p(1)} AND scope_space.${q("id")} = ${p(2)}) ORDER BY manifest.${q("id")} ASC LIMIT 1;`,
    tableName: "document_multimodal_manifests",
  });
  const row = result.rows[0];
  if (!row) {
    if (activeId) throw new Error("Durable deletion active multimodal manifest disappeared");
    return { complete: true, keys: [] };
  }
  const manifestId = stringColumn(row, "id");
  const items = DocumentMultimodalItemSchema.array().parse(jsonArrayColumn(row, "items"));
  const keys = new Set<string>();
  for (const item of items) {
    if (item.assetRef?.objectKey) keys.add(item.assetRef.objectKey);
    for (const variant of Object.values(item.assetRef?.variants ?? {})) {
      if (variant.objectKey) keys.add(variant.objectKey);
    }
  }
  const ordered = [...keys].sort();
  const offset = state.manifestKeyOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > ordered.length) {
    throw new Error("Durable deletion multimodal manifest cursor is invalid");
  }
  const pageKeys = ordered.slice(offset, offset + limit);
  const nextOffset = offset + pageKeys.length;
  if (nextOffset < ordered.length) {
    if (pageKeys.length === 0) {
      throw new Error("Durable deletion multimodal manifest cursor did not advance");
    }
    return {
      complete: false,
      keys: pageKeys,
      manifestActiveId: manifestId,
      manifestAfter: state.manifestAfter,
      manifestKeyOffset: nextOffset,
    };
  }
  return { complete: false, keys: pageKeys, manifestAfter: manifestId };
}

type DocumentDatabaseScan = "artifacts" | "raw" | "staged";

async function documentDatabaseObjectKeyPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  documentId: string,
  scan: DocumentDatabaseScan,
  cursor: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  if (
    scan === "raw" &&
    job.targetType === "document_asset" &&
    job.scanPhase !== "reconcile-after-dirty-primary"
  ) {
    return [];
  }
  const after = cursor ?? "";
  let tableName: string;
  let params: DatabaseQueryValue[];
  let sql: string;
  if (scan === "raw") {
    tableName = "document_assets";
    params = [documentId, job.knowledgeSpaceId, after, limit];
    sql = `SELECT ${q("object_key")} FROM ${q("document_assets")} WHERE ${q("id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("object_key")} > ${p(3)} ORDER BY ${q("object_key")} ASC LIMIT ${p(4)};`;
  } else if (scan === "artifacts") {
    tableName = "artifact_segments";
    params = [documentId, job.knowledgeSpaceId, after, limit];
    sql = `SELECT DISTINCT ${q("object_key")} FROM ${q("artifact_segments")} WHERE ${q("document_asset_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("object_key")} IS NOT NULL AND ${q("object_key")} > ${p(3)} ORDER BY ${q("object_key")} ASC LIMIT ${p(4)};`;
  } else {
    tableName = "knowledge_space_staged_commits";
    params = [documentId, job.knowledgeSpaceId, job.tenantId, after, limit];
    sql = `SELECT ${q("object_key")} FROM (SELECT ${q("raw_object_key")} AS ${q("object_key")} FROM ${q("knowledge_space_staged_commits")} WHERE ${q("document_asset_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("tenant_id")} = ${p(3)} AND ${q("raw_object_key")} IS NOT NULL UNION SELECT ${q("published_object_key")} AS ${q("object_key")} FROM ${q("knowledge_space_staged_commits")} WHERE ${q("document_asset_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("tenant_id")} = ${p(3)} AND ${q("published_object_key")} IS NOT NULL) ${q("staged_keys")} WHERE ${q("object_key")} > ${p(4)} ORDER BY ${q("object_key")} ASC LIMIT ${p(5)};`;
  }
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql,
    tableName,
  });
  return result.rows.map((row) => stringColumn(row, "object_key"));
}

function nextDocumentScan(
  scan: DocumentDatabaseScan,
): NonNullable<InventoryCursor["documentScan"]> {
  if (scan === "raw") return "artifacts";
  if (scan === "artifacts") return "staged";
  return "manifests";
}

interface SecretInventoryRef {
  readonly credentialRef: string;
  readonly id: string;
  readonly rowId: string;
}

async function lifecycleSecretRefs(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  cursor: string | undefined,
  limit: number,
): Promise<readonly SecretInventoryRef[]> {
  if (job.targetType === "document_asset" || job.targetType === "logical_document") return [];
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, cursor ?? "", limit];
  let target = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} = ${p(5)}`;
  }
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${q("id")}, ${q("source_id")}, ${q("credential_ref")} FROM ${q("source_secret_lifecycle_refs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} > ${p(3)} AND ${q("state")} <> 'deleted'${target} ORDER BY ${q("id")} ASC LIMIT ${p(4)};`,
    tableName: "source_secret_lifecycle_refs",
  });
  return result.rows.map((row) => ({
    credentialRef: stringColumn(row, "credential_ref"),
    id: stringColumn(row, "source_id"),
    rowId: stringColumn(row, "id"),
  }));
}

function secretInventoryItems(
  secrets: readonly SecretInventoryRef[],
  ordinal: number,
  maxAttempts: number,
) {
  return secrets.map((source, index) => ({
    credentialRef: source.credentialRef,
    idempotencyKey: digestKey("secret", source.credentialRef),
    kind: "secret_ref" as const,
    maxAttempts,
    ordinal: ordinal + index,
    resourceId: source.id,
  }));
}

async function sourceSecretRefs(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  cursor: string | undefined,
  limit: number,
): Promise<readonly { readonly credentialRef: string; readonly id: string }[]> {
  if (job.targetType === "document_asset" || job.targetType === "logical_document") return [];
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId, cursor ?? "", limit];
  let target = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    target = ` AND s.${q("id")} = ${p(5)}`;
  }
  const result = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT s.${q("id")}, s.${q("credential_ref")} FROM ${q("sources")} s WHERE s.${q("knowledge_space_id")} = ${p(2)} AND s.${q("id")} > ${p(3)} AND s.${q("credential_ref")} IS NOT NULL${target} AND EXISTS (SELECT 1 FROM ${q("knowledge_spaces")} ks WHERE ks.${q("tenant_id")} = ${p(1)} AND ks.${q("id")} = ${p(2)}) AND NOT EXISTS (SELECT 1 FROM ${q("source_secret_lifecycle_refs")} lifecycle WHERE lifecycle.${q("tenant_id")} = ${p(1)} AND lifecycle.${q("knowledge_space_id")} = ${p(2)} AND lifecycle.${q("source_id")} = s.${q("id")} AND lifecycle.${q("credential_ref")} = s.${q("credential_ref")}) ORDER BY s.${q("id")} ASC LIMIT ${p(4)};`,
    tableName: "sources",
  });
  return result.rows.map((row) => ({
    credentialRef: stringColumn(row, "credential_ref"),
    id: stringColumn(row, "id"),
  }));
}

async function markLifecycleSecretDeleted(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  input: { readonly credentialRef: string; readonly sourceId: string },
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const now = new Date().toISOString();
  await database.execute({
    maxRows: 0,
    operation: "update",
    params: [now, job.tenantId, job.knowledgeSpaceId, input.sourceId, input.credentialRef],
    sql: `UPDATE ${q("source_secret_lifecycle_refs")} SET ${q("state")} = 'deleted', ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL, ${q("next_delete_at")} = NULL, ${q("deleted_at")} = ${p(1)}, ${q("updated_at")} = ${p(1)}, ${q("row_version")} = ${q("row_version")} + 1 WHERE ${q("tenant_id")} = ${p(2)} AND ${q("knowledge_space_id")} = ${p(3)} AND ${q("source_id")} = ${p(4)} AND ${q("credential_ref")} = ${p(5)} AND ${q("state")} <> 'deleted';`,
    tableName: "source_secret_lifecycle_refs",
  });
}

async function getSpaceObjectPrefix(
  database: DatabaseAdapter,
  tenantId: string,
  knowledgeSpaceId: string,
): Promise<string> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId],
    sql: `SELECT ${q("object_key_prefix")} FROM ${q("knowledge_space_manifests")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName: "knowledge_space_manifests",
  });
  if (!result.rows[0]) throw new Error("Knowledge space object prefix is unavailable");
  return KnowledgeSpaceObjectKeyPrefixSchema.parse(
    stringColumn(result.rows[0], "object_key_prefix"),
  );
}

async function deleteAnswerTracePage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (job.targetType === "source" && job.deleteMode === "keep") return 0;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  return database.transaction(async (transaction) => {
    const targetParams = targetDocumentQueryParams(job);
    const limitPosition = targetParams.length + 1;
    const traceAlias = "target_trace";
    const traceTargetPredicate =
      job.targetType === "knowledge_space"
        ? ""
        : ` AND ${targetTraceEvidencePredicateSql(database, job, traceAlias)}`;
    const traces = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params: [...targetParams, limit],
      sql: `SELECT ${traceAlias}.${q("id")}, ${traceAlias}.${q("evidence_bundle_id")} FROM ${q("answer_traces")} AS ${traceAlias} WHERE ${traceAlias}.${q("knowledge_space_id")} = ${p(1)}${traceTargetPredicate} ORDER BY ${traceAlias}.${q("id")} ASC LIMIT ${p(limitPosition)} FOR UPDATE;`,
      tableName: "answer_traces",
    });
    if (traces.rows.length === 0) {
      // Evidence bundles intentionally have no knowledge-space FK. A crashed legacy writer may
      // therefore leave a target bundle without a trace; remove that bounded orphan page too.
      const bundleAlias = "target_bundle";
      const bundles = await transaction.execute({
        maxRows: limit,
        operation: "select",
        params: [...targetParams, limit],
        sql: `SELECT ${bundleAlias}.${q("id")} FROM ${q("evidence_bundles")} AS ${bundleAlias} WHERE ${targetEvidenceBundlePredicateSql(database, job, bundleAlias)} AND NOT EXISTS (SELECT 1 FROM ${q("answer_traces")} AS linked_trace WHERE linked_trace.${q("evidence_bundle_id")} = ${bundleAlias}.${q("id")} OR linked_trace.${q("id")} = ${bundleAlias}.${q("trace_id")}) ORDER BY ${bundleAlias}.${q("id")} ASC LIMIT ${p(limitPosition)} FOR UPDATE;`,
        tableName: "evidence_bundles",
      });
      const orphanBundleIds = bundles.rows.map((row) => stringColumn(row, "id"));
      await deleteIds(database, transaction, "evidence_bundles", "id", orphanBundleIds);
      if (orphanBundleIds.length > 0) return orphanBundleIds.length;

      // Research mode persists complete EvidenceBundle JSON separately from answer traces. Those
      // rows must use the identical target predicate or deleted citations remain queryable.
      const partialAlias = "target_research_partial";
      const evidenceBundleJson =
        database.dialect === "postgres"
          ? `${partialAlias}.${q("evidence_bundle")} -> 'items'`
          : `JSON_EXTRACT(${partialAlias}.${q("evidence_bundle")}, '$.items')`;
      const partials = await transaction.execute({
        maxRows: limit,
        operation: "select",
        params: [...targetParams, limit],
        sql: `SELECT ${partialAlias}.${q("id")} FROM ${q("research_task_partial_results")} AS ${partialAlias} WHERE ${partialAlias}.${q("knowledge_space_id")} = ${p(1)} AND ${targetEvidenceItemsPredicateSql(database, job, evidenceBundleJson)} ORDER BY ${partialAlias}.${q("id")} ASC LIMIT ${p(limitPosition)} FOR UPDATE;`,
        tableName: "research_task_partial_results",
      });
      const partialIds = partials.rows.map((row) => stringColumn(row, "id"));
      await deleteIds(database, transaction, "research_task_partial_results", "id", partialIds);
      return partialIds.length;
    }
    const traceIds = traces.rows.map((row) => stringColumn(row, "id"));
    const directBundleIds = traces.rows
      .map((row) => optionalStringColumn(row, "evidence_bundle_id"))
      .filter((id): id is string => Boolean(id));

    // Inventory the whole per-trace evidence closure before any mutation. The normal model is
    // one-to-one; the explicit limit check fails closed if corrupt legacy rows fan out unboundedly.
    const bundleWhere: string[] = [];
    const bundleParams: DatabaseQueryValue[] = [];
    if (directBundleIds.length > 0) {
      bundleWhere.push(
        `${q("id")} IN (${appendPlaceholders(database, bundleParams, directBundleIds)})`,
      );
    }
    bundleWhere.push(
      `${q("trace_id")} IN (${appendPlaceholders(database, bundleParams, traceIds)})`,
    );
    bundleParams.push(limit + 1);
    const relatedBundles = await transaction.execute({
      maxRows: limit + 1,
      operation: "select",
      params: bundleParams,
      sql: `SELECT ${q("id")} FROM ${q("evidence_bundles")} WHERE ${bundleWhere.join(" OR ")} ORDER BY ${q("id")} ASC LIMIT ${p(bundleParams.length)} FOR UPDATE;`,
      tableName: "evidence_bundles",
    });
    if (relatedBundles.rows.length > limit) {
      throw new Error(`Durable deletion trace evidence closure exceeds limit=${limit}`);
    }
    const bundleIds = relatedBundles.rows.map((row) => stringColumn(row, "id"));

    // failed_queries deliberately has no trace FK, while TiDB deployments cannot universally rely
    // on cascades being enabled. Delete every trace-owned row explicitly in the same transaction.
    await deleteIds(database, transaction, "failed_queries", "answer_trace_id", traceIds);
    await deleteIds(database, transaction, "answer_trace_steps", "trace_id", traceIds);
    await deleteIds(database, transaction, "answer_traces", "id", traceIds);
    if (bundleIds.length > 0) {
      await clearEvidenceBundleTraceLinks(database, transaction, bundleIds, traceIds);
      await deleteUnreferencedEvidenceBundles(database, transaction, bundleIds);
    }
    return traceIds.length;
  });
}

async function deleteGoldenQuestionPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  return database.transaction(async (transaction) => {
    const params = targetDocumentQueryParams(job);
    params.push(limit);
    const alias = "target_golden_question";
    const rows = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: `SELECT ${alias}.${q("id")} FROM ${q("golden_questions")} AS ${alias} WHERE ${alias}.${q("knowledge_space_id")} = ${p(1)} AND ${targetGoldenQuestionPredicateSql(database, job, alias)} ORDER BY ${alias}.${q("id")} ASC LIMIT ${p(params.length)} FOR UPDATE;`,
      tableName: "golden_questions",
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    await deleteIds(database, transaction, "golden_questions", "id", ids);
    return ids.length;
  });
}

function targetGoldenQuestionPredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  questionAlias: string,
): string {
  if (
    job.targetType === "knowledge_space" ||
    (job.targetType === "source" && job.deleteMode === "keep")
  ) {
    return "1 = 1";
  }
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const metadata = `${questionAlias}.${q("metadata")}`;
  const expectedEvidence = `${questionAlias}.${q("expected_evidence_ids")}`;
  const contextItems =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceContext' -> 'items'`
      : `JSON_EXTRACT(${metadata}, '$.evidenceContext.items')`;
  const expectedPredicate = goldenEvidenceIdArrayPredicateSql(
    database,
    job,
    expectedEvidence,
    "golden_expected",
  );
  const contextExpected =
    database.dialect === "postgres"
      ? `${metadata} -> 'evidenceContext' -> 'expectedEvidenceIds'`
      : `JSON_EXTRACT(${metadata}, '$.evidenceContext.expectedEvidenceIds')`;
  const contextExpectedPredicate = goldenEvidenceIdArrayPredicateSql(
    database,
    job,
    contextExpected,
    "golden_context_expected",
  );
  const missingEvidencePredicate = goldenMissingEvidencePredicateSql(database, job, metadata);
  const traceId =
    database.dialect === "postgres"
      ? `COALESCE(${metadata} ->> 'traceId', ${metadata} ->> 'answerTraceId', ${metadata} -> 'evidenceContext' ->> 'traceId')`
      : `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.traceId')), JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.answerTraceId')), JSON_UNQUOTE(JSON_EXTRACT(${metadata}, '$.evidenceContext.traceId')))`;
  const traceIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_trace.${q("id")} AS TEXT) = ${traceId}`
      : `CAST(golden_trace.${q("id")} AS CHAR(36)) = ${traceId}`;
  const relatedTrace = `EXISTS (SELECT 1 FROM ${q("answer_traces")} AS golden_trace WHERE golden_trace.${q("knowledge_space_id")} = ${p(1)} AND ${traceIdMatch} AND ${targetTraceEvidencePredicateSql(database, job, "golden_trace")})`;
  return `(${expectedPredicate} OR ${contextExpectedPredicate} OR ${missingEvidencePredicate} OR ${targetEvidenceItemsPredicateSql(database, job, contextItems)} OR ${relatedTrace})`;
}

function goldenEvidenceIdArrayPredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  jsonArray: string,
  alias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const evidenceId =
    database.dialect === "postgres" ? `${alias}.evidence_id` : `${alias}.evidence_id`;
  const directDocument = targetDocumentMembershipSql(database, job, evidenceId, true);
  const nodeDocument = targetDocumentMembershipSql(
    database,
    job,
    `golden_node.${q("document_asset_id")}`,
    false,
  );
  const nodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_node.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_node.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const bundleIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_bundle.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_bundle.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const traceIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_expected_trace.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_expected_trace.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const target = `(${directDocument} OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS golden_node WHERE golden_node.${q("knowledge_space_id")} = ${p(1)} AND ${nodeIdMatch} AND ${nodeDocument}) OR EXISTS (SELECT 1 FROM ${q("evidence_bundles")} AS golden_bundle WHERE ${bundleIdMatch} AND ${targetEvidenceBundlePredicateSql(database, job, "golden_bundle")}) OR EXISTS (SELECT 1 FROM ${q("answer_traces")} AS golden_expected_trace WHERE golden_expected_trace.${q("knowledge_space_id")} = ${p(1)} AND ${traceIdMatch} AND ${targetTraceEvidencePredicateSql(database, job, "golden_expected_trace")}))`;
  if (database.dialect === "postgres") {
    const safeArray = `CASE WHEN jsonb_typeof(${jsonArray}) = 'array' THEN ${jsonArray} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${safeArray}) AS ${alias}(evidence_id) WHERE ${target})`;
  }
  return `EXISTS (SELECT 1 FROM JSON_TABLE(${jsonArray}, '$[*]' COLUMNS (evidence_id VARCHAR(255) PATH '$')) AS ${alias} WHERE ${target})`;
}

function goldenMissingEvidencePredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  metadata: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const evidenceId = "golden_missing.evidence_id";
  const directDocument = targetDocumentMembershipSql(database, job, evidenceId, true);
  const nodeDocument = targetDocumentMembershipSql(
    database,
    job,
    `golden_missing_node.${q("document_asset_id")}`,
    false,
  );
  const nodeIdMatch =
    database.dialect === "postgres"
      ? `CAST(golden_missing_node.${q("id")} AS TEXT) = ${evidenceId}`
      : `CAST(golden_missing_node.${q("id")} AS CHAR(36)) = ${evidenceId}`;
  const target = `(${directDocument} OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS golden_missing_node WHERE golden_missing_node.${q("knowledge_space_id")} = ${p(1)} AND ${nodeIdMatch} AND ${nodeDocument}))`;
  if (database.dialect === "postgres") {
    const missing = `${metadata} -> 'evidenceContext' -> 'missingEvidence'`;
    const safeMissing = `CASE WHEN jsonb_typeof(${missing}) = 'array' THEN ${missing} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements(${safeMissing}) AS golden_missing_item(value) CROSS JOIN LATERAL (SELECT golden_missing_item.value ->> 'expectedEvidenceId' AS evidence_id) AS golden_missing WHERE ${target})`;
  }
  return `EXISTS (SELECT 1 FROM JSON_TABLE(${metadata}, '$.evidenceContext.missingEvidence[*]' COLUMNS (evidence_id VARCHAR(255) PATH '$.expectedEvidenceId')) AS golden_missing WHERE ${target})`;
}

function targetDocumentQueryParams(
  job: DurableDeletionTargetOperationInput["job"],
): DatabaseQueryValue[] {
  return job.targetType === "knowledge_space"
    ? [job.knowledgeSpaceId]
    : [job.knowledgeSpaceId, job.targetId];
}

function targetEvidenceBundlePredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  bundleAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return targetEvidenceItemsPredicateSql(database, job, `${bundleAlias}.${q("items")}`);
}

function targetTraceEvidencePredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  traceAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const bundleAlias = "target_bundle";
  const stepAlias = "target_inline_evidence_step";
  const inlineItems =
    database.dialect === "postgres"
      ? `${stepAlias}.${q("metadata")} -> 'evidenceBundle' -> 'items'`
      : `COALESCE(JSON_EXTRACT(${stepAlias}.${q(
          "metadata",
        )}, '$.evidenceBundle.items'), JSON_ARRAY())`;
  const persistedBundle = `EXISTS (SELECT 1 FROM ${q(
    "evidence_bundles",
  )} AS ${bundleAlias} WHERE (${bundleAlias}.${q("id")} = ${traceAlias}.${q(
    "evidence_bundle_id",
  )} OR ${bundleAlias}.${q("trace_id")} = ${traceAlias}.${q(
    "id",
  )}) AND ${targetEvidenceBundlePredicateSql(database, job, bundleAlias)})`;
  const inlineBundle = `EXISTS (SELECT 1 FROM ${q(
    "answer_trace_steps",
  )} AS ${stepAlias} WHERE ${stepAlias}.${q("trace_id")} = ${traceAlias}.${q(
    "id",
  )} AND ${targetEvidenceItemsPredicateSql(database, job, inlineItems)})`;

  return `(${persistedBundle} OR ${inlineBundle})`;
}

function targetEvidenceItemsPredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  items: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const itemTargetDocument = targetDocumentMembershipSql(
    database,
    job,
    database.dialect === "postgres"
      ? `target_citation.value ->> 'documentAssetId'`
      : "target_citation.document_asset_id",
    true,
  );
  const nodeTargetDocument = targetDocumentMembershipSql(
    database,
    job,
    `target_node.${q("document_asset_id")}`,
    false,
  );
  if (database.dialect === "postgres") {
    const safeItems = `CASE WHEN jsonb_typeof(${items}) = 'array' THEN ${items} ELSE '[]'::jsonb END`;
    const citations = `target_item.value -> 'citations'`;
    const safeCitations = `CASE WHEN jsonb_typeof(${citations}) = 'array' THEN ${citations} ELSE '[]'::jsonb END`;
    return `EXISTS (SELECT 1 FROM jsonb_array_elements(${safeItems}) AS target_item(value) WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(${safeCitations}) AS target_citation(value) WHERE ${itemTargetDocument}) OR EXISTS (SELECT 1 FROM ${q("knowledge_nodes")} AS target_node WHERE target_node.${q("knowledge_space_id")} = ${p(1)} AND CAST(target_node.${q("id")} AS TEXT) = target_item.value ->> 'nodeId' AND ${nodeTargetDocument}))`;
  }
  return `(EXISTS (SELECT 1 FROM JSON_TABLE(${items}, '$[*].citations[*]' COLUMNS (document_asset_id VARCHAR(255) PATH '$.documentAssetId')) AS target_citation WHERE ${itemTargetDocument}) OR EXISTS (SELECT 1 FROM JSON_TABLE(${items}, '$[*]' COLUMNS (node_id VARCHAR(255) PATH '$.nodeId')) AS target_item INNER JOIN ${q("knowledge_nodes")} AS target_node ON CAST(target_node.${q("id")} AS CHAR(36)) = target_item.node_id WHERE target_node.${q("knowledge_space_id")} = ${p(1)} AND ${nodeTargetDocument}))`;
}

function targetDocumentMembershipSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  documentIdExpression: string,
  textComparison: boolean,
): string {
  return targetDocumentMembershipAtSql(database, job, documentIdExpression, textComparison, 1, 2);
}

function targetDocumentMembershipAtSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  documentIdExpression: string,
  textComparison: boolean,
  spaceParamPosition: number,
  targetParamPosition: number,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  if (job.targetType === "document_asset") {
    return `${documentIdExpression} = ${p(targetParamPosition)}`;
  }
  if (job.targetType === "logical_document") {
    const selectedRevisionAsset = textComparison
      ? database.dialect === "postgres"
        ? `CAST(owned_revision.${q("document_asset_id")} AS TEXT)`
        : `CAST(owned_revision.${q("document_asset_id")} AS CHAR(36))`
      : `owned_revision.${q("document_asset_id")}`;
    return `${documentIdExpression} IN (SELECT ${selectedRevisionAsset} FROM ${q("document_revisions")} owned_revision WHERE owned_revision.${q("knowledge_space_id")} = ${p(spaceParamPosition)} AND owned_revision.${q("document_id")} = ${p(targetParamPosition)} AND NOT EXISTS (SELECT 1 FROM ${q("document_revisions")} external_revision WHERE external_revision.${q("knowledge_space_id")} = ${p(spaceParamPosition)} AND external_revision.${q("document_id")} <> ${p(targetParamPosition)} AND external_revision.${q("document_asset_id")} = owned_revision.${q("document_asset_id")}))`;
  }
  const selectedDocumentId = textComparison
    ? database.dialect === "postgres"
      ? `CAST(target_document.${q("id")} AS TEXT)`
      : `CAST(target_document.${q("id")} AS CHAR(36))`
    : `target_document.${q("id")}`;
  return `${documentIdExpression} IN (SELECT ${selectedDocumentId} FROM ${q("document_assets")} AS target_document WHERE target_document.${q("knowledge_space_id")} = ${p(spaceParamPosition)} AND target_document.${q("source_id")} = ${p(targetParamPosition)})`;
}

function appendPlaceholders(
  database: DatabaseAdapter,
  params: DatabaseQueryValue[],
  values: readonly DatabaseQueryValue[],
): string {
  const start = params.length;
  params.push(...values);
  return values.map((_, index) => databasePlaceholder(database, start + index + 1)).join(", ");
}

async function clearEvidenceBundleTraceLinks(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  bundleIds: readonly string[],
  traceIds: readonly string[],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [];
  const bundlePlaceholders = appendPlaceholders(database, params, bundleIds);
  const tracePlaceholders = appendPlaceholders(database, params, traceIds);
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q("evidence_bundles")} SET ${q("trace_id")} = NULL WHERE ${q("id")} IN (${bundlePlaceholders}) AND ${q("trace_id")} IN (${tracePlaceholders});`,
    tableName: "evidence_bundles",
  });
}

async function deleteUnreferencedEvidenceBundles(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  bundleIds: readonly string[],
): Promise<void> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const placeholders = bundleIds
    .map((_, index) => databasePlaceholder(database, index + 1))
    .join(", ");
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params: bundleIds,
    sql: `DELETE FROM ${q("evidence_bundles")} WHERE ${q("id")} IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM ${q("answer_traces")} AS remaining_trace WHERE remaining_trace.${q("evidence_bundle_id")} = ${q("evidence_bundles")}.${q("id")} OR remaining_trace.${q("id")} = ${q("evidence_bundles")}.${q("trace_id")});`,
    tableName: "evidence_bundles",
  });
}

async function deleteDocumentDerivedResiduePage(
  database: DatabaseAdapter,
  graph: Pick<
    ReturnType<typeof createDatabaseGraphIndexRepository>,
    "deleteComponentsBySourceNodesAcrossGenerations"
  >,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  if (
    job.targetType === "knowledge_space" ||
    (job.targetType === "source" && job.deleteMode === "keep")
  ) {
    return 0;
  }
  const foreignKeyChildrenDeleted = await deleteTargetDocumentForeignKeyChildPage(
    database,
    job,
    limit,
  );
  if (foreignKeyChildrenDeleted > 0) return foreignKeyChildrenDeleted;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId, limit, job.targetId];
  const documentMembership = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    false,
    1,
    3,
  );
  const documentPredicate = documentMembership.replace("TARGET_DOCUMENT_ID ", "");
  const textDocumentMembership = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    true,
    1,
    3,
  );
  const textDocumentPredicate = textDocumentMembership.replace("TARGET_DOCUMENT_ID ", "");
  const semanticPaths = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT semantic_path.${q("id")} FROM ${q("knowledge_paths")} AS semantic_path WHERE semantic_path.${q("knowledge_space_id")} = ${p(1)} AND ${targetSemanticPathPredicateSql(database, documentPredicate, textDocumentPredicate)} ORDER BY semantic_path.${q("id")} ASC LIMIT ${p(2)};`,
    tableName: "knowledge_paths",
  });
  const semanticPathIds = semanticPaths.rows.map((row) => stringColumn(row, "id"));
  if (semanticPathIds.length > 0) {
    await deleteIds(database, database, "knowledge_paths", "id", semanticPathIds);
    return semanticPathIds.length;
  }
  const nodes = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("knowledge_nodes")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("document_asset_id")} ${documentPredicate} ORDER BY ${q("id")} ASC LIMIT ${p(2)};`,
    tableName: "knowledge_nodes",
  });
  const nodeIds = nodes.rows.map((row) => stringColumn(row, "id"));
  if (nodeIds.length > 0) {
    // Graph JSON references have no FK. Prune first; a crash before node deletion is safely
    // replayable, while deleting nodes first would permanently lose the exact scrub key set.
    await graph.deleteComponentsBySourceNodesAcrossGenerations({
      knowledgeSpaceId: job.knowledgeSpaceId,
      maxGenerations: 10_000,
      maxSourceNodes: limit,
      sourceNodeIds: nodeIds,
    });
    const projectionParams: DatabaseQueryValue[] = [job.knowledgeSpaceId];
    const projectionNodeIds = appendPlaceholders(database, projectionParams, nodeIds);
    projectionParams.push(limit);
    const projections = await database.execute({
      maxRows: limit,
      operation: "select",
      params: projectionParams,
      sql: `SELECT ${q("id")} FROM ${q("index_projections")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("node_id")} IN (${projectionNodeIds}) ORDER BY ${q("id")} ASC LIMIT ${p(projectionParams.length)};`,
      tableName: "index_projections",
    });
    const projectionIds = projections.rows.map((row) => stringColumn(row, "id"));
    if (projectionIds.length > 0) {
      const postingParams: DatabaseQueryValue[] = [job.knowledgeSpaceId];
      const postingProjectionIds = appendPlaceholders(database, postingParams, projectionIds);
      postingParams.push(limit);
      const postings = await database.execute({
        maxRows: limit,
        operation: "select",
        params: postingParams,
        sql: `SELECT ${q("id")} FROM ${q("index_projection_fts_postings")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("projection_id")} IN (${postingProjectionIds}) ORDER BY ${q("id")} ASC LIMIT ${p(postingParams.length)};`,
        tableName: "index_projection_fts_postings",
      });
      const postingIds = postings.rows.map((row) => stringColumn(row, "id"));
      if (postingIds.length > 0) {
        await deleteIds(database, database, "index_projection_fts_postings", "id", postingIds);
        return postingIds.length;
      }
      await deleteIds(database, database, "index_projections", "id", projectionIds);
      return projectionIds.length;
    }
    if (
      (await graphHasSourceNodeReferences(database, "graph_entities", nodeIds)) ||
      (await graphHasSourceNodeReferences(database, "graph_relations", nodeIds))
    ) {
      throw new Error("Durable deletion graph source-node residual probe failed");
    }
    await deleteIds(database, database, "knowledge_nodes", "id", nodeIds);
    return nodeIds.length;
  }

  // These worker ledgers deliberately have no document FK. Delete exact composite-key pages before
  // the target document disappears and the source->document predicate can no longer be evaluated.
  for (const ledger of [
    {
      parentSpaceColumn: "knowledge_space_id",
      parentTable: "page_index_upgrade_backfills",
      table: "page_index_upgrade_backfill_items",
    },
    {
      parentSpaceColumn: "knowledge_space_id",
      parentTable: "legacy_space_publication_bootstraps",
      table: "legacy_space_publication_bootstrap_items",
    },
  ] as const) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: `SELECT ${q(ledger.table === "page_index_upgrade_backfill_items" ? "backfill_id" : "bootstrap_id")}, ${q(ledger.table === "page_index_upgrade_backfill_items" ? "document_outline_id" : "document_asset_id")} FROM ${q(ledger.table)} WHERE ${q(ledger.table === "page_index_upgrade_backfill_items" ? "backfill_id" : "bootstrap_id")} IN (SELECT ${q("id")} FROM ${q(ledger.parentTable)} WHERE ${q(ledger.parentSpaceColumn)} = ${p(1)}) AND ${q("document_asset_id")} ${documentPredicate} ORDER BY ${q(ledger.table === "page_index_upgrade_backfill_items" ? "backfill_id" : "bootstrap_id")} ASC, ${q(ledger.table === "page_index_upgrade_backfill_items" ? "document_outline_id" : "document_asset_id")} ASC LIMIT ${p(2)};`,
      tableName: ledger.table,
    });
    const firstColumn =
      ledger.table === "page_index_upgrade_backfill_items" ? "backfill_id" : "bootstrap_id";
    const secondColumn =
      ledger.table === "page_index_upgrade_backfill_items"
        ? "document_outline_id"
        : "document_asset_id";
    const keys = rows.rows.map(
      (row) => [stringColumn(row, firstColumn), stringColumn(row, secondColumn)] as const,
    );
    if (keys.length > 0) {
      await deleteCompositeIds(database, database, ledger.table, [firstColumn, secondColumn], keys);
      return keys.length;
    }
  }

  for (const [table, column, targetPredicate, additionalPredicate] of [
    ["page_index_manifests", "document_asset_id", documentPredicate, ""],
    ["document_outlines", "document_asset_id", documentPredicate, ""],
    ["document_multimodal_manifests", "document_asset_id", documentPredicate, ""],
    ["knowledge_space_staged_commits", "document_asset_id", documentPredicate, ""],
  ] as const) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q(column)} ${targetPredicate}${additionalPredicate} ORDER BY ${q("id")} ASC LIMIT ${p(2)};`,
      tableName: table,
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    if (ids.length > 0) {
      await deleteIds(database, database, table, "id", ids);
      return ids.length;
    }
  }
  const parseArtifacts = await database.execute({
    maxRows: limit,
    operation: "select",
    params,
    sql: `SELECT artifact.${q("id")} FROM ${q("parse_artifacts")} AS artifact WHERE artifact.${q("document_asset_id")} ${documentPredicate} ORDER BY artifact.${q("id")} ASC LIMIT ${p(2)};`,
    tableName: "parse_artifacts",
  });
  const parseArtifactIds = parseArtifacts.rows.map((row) => stringColumn(row, "id"));
  await deleteIds(database, database, "parse_artifacts", "id", parseArtifactIds);
  if (parseArtifactIds.length > 0) return parseArtifactIds.length;
  return 0;
}

async function deleteTargetDocumentForeignKeyChildPage(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  limit: number,
): Promise<number> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId, limit, job.targetId];
  const documentPredicate = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    false,
    1,
    3,
  ).replace("TARGET_DOCUMENT_ID ", "");
  const queries = [
    {
      sql: `SELECT child.${q("id")} FROM ${q("document_compilation_outbox")} AS child WHERE child.${q("attempt_id")} IN (SELECT attempt.${q("id")} FROM ${q("document_compilation_attempts")} AS attempt WHERE attempt.${q("knowledge_space_id")} = ${p(1)} AND attempt.${q("document_asset_id")} ${documentPredicate}) ORDER BY child.${q("id")} ASC LIMIT ${p(2)};`,
      table: "document_compilation_outbox",
    },
    {
      sql: `SELECT term.${q("id")} FROM ${q("page_index_terms")} AS term WHERE term.${q("knowledge_space_id")} = ${p(1)} AND term.${q("manifest_id")} IN (SELECT manifest.${q("id")} FROM ${q("page_index_manifests")} AS manifest WHERE manifest.${q("knowledge_space_id")} = ${p(1)} AND manifest.${q("document_asset_id")} ${documentPredicate}) ORDER BY term.${q("id")} ASC LIMIT ${p(2)};`,
      table: "page_index_terms",
    },
    {
      sql: `SELECT child.${q("id")} FROM ${q("page_index_nodes")} AS child WHERE child.${q("manifest_id")} IN (SELECT manifest.${q("id")} FROM ${q("page_index_manifests")} AS manifest WHERE manifest.${q("knowledge_space_id")} = ${p(1)} AND manifest.${q("document_asset_id")} ${documentPredicate}) ORDER BY child.${q("id")} ASC LIMIT ${p(2)};`,
      table: "page_index_nodes",
    },
    {
      sql: `SELECT ${q("id")} FROM ${q("document_compilation_attempts")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("document_asset_id")} ${documentPredicate} ORDER BY ${q("id")} ASC LIMIT ${p(2)};`,
      table: "document_compilation_attempts",
    },
    {
      sql: `SELECT ${q("id")} FROM ${q("artifact_segments")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("document_asset_id")} ${documentPredicate} ORDER BY ${q("id")} ASC LIMIT ${p(2)};`,
      table: "artifact_segments",
    },
  ] as const;
  for (const query of queries) {
    const rows = await database.execute({
      maxRows: limit,
      operation: "select",
      params,
      sql: query.sql,
      tableName: query.table,
    });
    const ids = rows.rows.map((row) => stringColumn(row, "id"));
    if (ids.length > 0) {
      await deleteIds(database, database, query.table, "id", ids);
      return ids.length;
    }
  }
  return 0;
}

function targetSemanticPathPredicateSql(
  database: DatabaseAdapter,
  documentPredicate: string,
  textDocumentPredicate: string,
  spaceParamPosition = 1,
  pathAlias = "semantic_path",
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const documentReferences = (pathAlias: string, referenceAlias: string) => {
    const metadata = `${pathAlias}.${q("metadata")}`;
    if (database.dialect === "postgres") {
      const values = `${metadata} -> 'documentAssetIds'`;
      return `EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(${values}) = 'array' THEN ${values} ELSE '[]'::jsonb END) AS ${referenceAlias}(document_asset_id) WHERE ${referenceAlias}.document_asset_id ${textDocumentPredicate})`;
    }
    return `EXISTS (SELECT 1 FROM JSON_TABLE(${metadata}, '$.documentAssetIds[*]' COLUMNS (document_asset_id VARCHAR(255) PATH '$')) AS ${referenceAlias} WHERE ${referenceAlias}.document_asset_id ${textDocumentPredicate})`;
  };
  const sourceNodeReferences = (pathAlias: string) => {
    const metadata = `${pathAlias}.${q("metadata")}`;
    const sourceRows =
      database.dialect === "postgres"
        ? `jsonb_array_elements_text(CASE WHEN jsonb_typeof(${metadata} -> 'sourceSummaryNodeIds') = 'array' THEN ${metadata} -> 'sourceSummaryNodeIds' ELSE '[]'::jsonb END) AS semantic_source_ref(node_id)`
        : `JSON_TABLE(${metadata}, '$.sourceSummaryNodeIds[*]' COLUMNS (node_id VARCHAR(255) PATH '$')) AS semantic_source_ref`;
    const nodeIdMatch =
      database.dialect === "postgres"
        ? `CAST(semantic_source_node.${q("id")} AS TEXT) = semantic_source_ref.node_id`
        : `CAST(semantic_source_node.${q("id")} AS CHAR(36)) = semantic_source_ref.node_id`;
    return `EXISTS (SELECT 1 FROM ${sourceRows} INNER JOIN ${q("knowledge_nodes")} AS semantic_source_node ON ${nodeIdMatch} WHERE semantic_source_node.${q("knowledge_space_id")} = ${p(spaceParamPosition)} AND semantic_source_node.${q("document_asset_id")} ${documentPredicate})`;
  };
  const communityId =
    database.dialect === "postgres"
      ? `${pathAlias}.${q("metadata")} ->> 'communityId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(${pathAlias}.${q("metadata")}, '$.communityId'))`;
  const rootCommunityId =
    database.dialect === "postgres"
      ? `target_community.${q("metadata")} ->> 'communityId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(target_community.${q("metadata")}, '$.communityId'))`;
  const targetedCommunity = `${pathAlias}.${q("view_name")} = 'by-community' AND ${communityId} IS NOT NULL AND EXISTS (SELECT 1 FROM ${q("knowledge_paths")} AS target_community WHERE target_community.${q("knowledge_space_id")} = ${p(spaceParamPosition)} AND target_community.${q("view_name")} = 'by-community' AND ${rootCommunityId} = ${communityId} AND ${documentReferences("target_community", "target_community_document")})`;
  return `((${pathAlias}.${q("resource_type")} = 'document' AND ${pathAlias}.${q("target_id")} ${textDocumentPredicate}) OR ${documentReferences(pathAlias, "semantic_document_ref")} OR ${sourceNodeReferences(pathAlias)} OR (${targetedCommunity}))`;
}

async function deleteCompositeIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  columns: readonly [string, string],
  keys: readonly (readonly [string, string])[],
): Promise<void> {
  if (keys.length === 0) return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [];
  const predicates = keys.map((key) => {
    const first = appendPlaceholders(database, params, [key[0]]);
    const second = appendPlaceholders(database, params, [key[1]]);
    return `(${q(columns[0])} = ${first} AND ${q(columns[1])} = ${second})`;
  });
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params,
    sql: `DELETE FROM ${q(table)} WHERE ${predicates.join(" OR ")};`,
    tableName: table,
  });
}

async function graphHasSourceNodeReferences(
  database: DatabaseAdapter,
  table: "graph_entities" | "graph_relations",
  nodeIds: readonly string[],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const overlap =
    database.dialect === "postgres"
      ? `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${q("source_node_ids")}) source_id WHERE source_id.value IN (SELECT jsonb_array_elements_text(${p(1)}::jsonb)))`
      : `JSON_OVERLAPS(${q("source_node_ids")}, CAST(${p(1)} AS JSON))`;
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [JSON.stringify(nodeIds)],
    sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${overlap} LIMIT 1;`,
    tableName: table,
  });
  return result.rows.length > 0;
}

async function hasAgentWorkspaceSnapshotResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q("agent_workspace_snapshots")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName: "agent_workspace_snapshots",
  });
  return result.rows.length > 0;
}

async function hasKnowledgeFsHistoryResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const targetAlias = "target_lease";
  const targetLease = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: targetKnowledgeFsLeaseParams(job),
    sql: `SELECT ${targetAlias}.${q("id")} FROM ${q("knowledge_fs_leases")} AS ${targetAlias} WHERE ${targetKnowledgeFsLeasePredicateSql(database, job, targetAlias)} LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  if (targetLease.rows.length > 0) return true;

  for (const table of ["knowledge_fs_leases", "knowledge_fs_sessions"] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  return false;
}

async function hasTargetGoldenQuestionResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const alias = "target_golden_question";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: targetDocumentQueryParams(job),
    sql: `SELECT ${alias}.${q("id")} FROM ${q("golden_questions")} AS ${alias} WHERE ${alias}.${q("knowledge_space_id")} = ${p(1)} AND ${targetGoldenQuestionPredicateSql(database, job, alias)} LIMIT 1;`,
    tableName: "golden_questions",
  });
  return result.rows.length > 0;
}

async function hasTargetHistoricalPublicationResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const documentAssetIds = await targetDocumentIdsForDeletion(database, job, executor);
  if (documentAssetIds.length === 0) return false;
  return hasHistoricalPublicationResidue(database, executor, {
    documentAssetIds,
    knowledgeSpaceId: job.knowledgeSpaceId,
    maxDocumentAssetIds: MaxDurableDeletionTargetDocuments,
    tenantId: job.tenantId,
  });
}

async function hasSourceProductDerivedResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  if (job.targetType !== "knowledge_space" && job.targetType !== "source") return false;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const runParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  if (job.targetType === "source") runParams.push(job.targetId);
  const runScope = sourceWorkflowRunScopeSql(database, job, "target_run", 1, 2, 3);
  for (const table of ["source_workflow_outbox", "source_crawl_preview_pages"] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: runParams,
      sql: `SELECT child.${q("id")} FROM ${q(table)} child INNER JOIN ${q("source_workflow_runs")} target_run ON target_run.${q("id")} = child.${q("run_id")} WHERE ${runScope} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  const run = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: runParams,
    sql: `SELECT target_run.${q("id")} FROM ${q("source_workflow_runs")} target_run WHERE ${runScope} LIMIT 1;`,
    tableName: "source_workflow_runs",
  });
  if (run.rows.length > 0) return true;

  const scopedParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  const sourceTarget = job.targetType === "source" ? ` AND ${q("source_id")} = ${p(3)}` : "";
  if (job.targetType === "source") scopedParams.push(job.targetId);
  for (const table of ["source_bulk_workflow_items", "source_sync_policies"] as const) {
    const retainedRemovalAudit =
      job.targetType === "source" && table === "source_bulk_workflow_items"
        ? ` AND ${q("action")} <> 'remove'`
        : "";
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: scopedParams,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${sourceTarget}${retainedRemovalAudit} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  if (job.targetType === "knowledge_space") {
    for (const table of ["source_oauth_transactions", "source_connection_secret_refs"] as const) {
      const result = await executor.execute({
        maxRows: 1,
        operation: "select",
        params: [job.tenantId, job.knowledgeSpaceId],
        sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
        tableName: table,
      });
      if (result.rows.length > 0) return true;
    }
  }
  return false;
}

async function hasForbiddenDerivedResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  if (await hasRetrievalExecutionLeaseResidue(database, executor, job)) return true;
  if (await hasOpaqueSpaceResidue(database, executor, job, "resource_mounts", true)) return true;
  if (await hasOpaqueSpaceResidue(database, executor, job, "failed_queries", false)) return true;
  if (await hasAgentWorkspaceSnapshotResidue(database, executor, job)) return true;
  if (await hasQualityControlResidue(database, executor, job)) return true;
  if (await hasKnowledgeFsHistoryResidue(database, executor, job)) return true;
  if (await hasTargetGoldenQuestionResidue(database, executor, job)) return true;
  if (
    await hasResearchTaskSpaceResidue(database, executor, {
      knowledgeSpaceId: job.knowledgeSpaceId,
      tenantId: job.tenantId,
    })
  ) {
    return true;
  }
  if (await hasTargetHistoricalPublicationResidue(database, executor, job)) return true;
  if (await hasSourceProductDerivedResidue(database, executor, job)) return true;
  if (job.targetType === "knowledge_space" || job.targetType === "source") {
    const lifecycleParams: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
    let sourcePredicate = "";
    if (job.targetType === "source") {
      lifecycleParams.push(job.targetId);
      sourcePredicate = ` AND ${q("source_id")} = ${p(3)}`;
    }
    const lifecycle = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: lifecycleParams,
      sql: `SELECT ${q("id")} FROM ${q("source_secret_lifecycle_refs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${sourcePredicate} AND ${q("state")} <> 'deleted' LIMIT 1;`,
      tableName: "source_secret_lifecycle_refs",
    });
    if (lifecycle.rows.length > 0) return true;
  }
  if (job.targetType === "source") {
    const directSourcePath = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId, job.targetId],
      sql: `SELECT ${q("id")} FROM ${q("knowledge_paths")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ((${q("resource_type")} = 'source' AND ${q("target_id")} = ${p(2)}) OR ${q("virtual_path")} = CONCAT('/sources/', ${p(2)})) LIMIT 1;`,
      tableName: "knowledge_paths",
    });
    if (directSourcePath.rows.length > 0) return true;
  }
  if (job.targetType === "source" && job.deleteMode === "keep") {
    const retainedMetadata = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId, job.targetId],
      sql: `SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("source_id")} = ${p(2)} AND ${sourceIdentityMetadataPredicateSql(database, q("metadata"), false)} LIMIT 1;`,
      tableName: "document_assets",
    });
    if (retainedMetadata.rows.length > 0) return true;
    const publicationMetadata = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.tenantId, job.knowledgeSpaceId],
      sql: `SELECT current_publication.${q("id")} FROM ${q("projection_set_publication_heads")} AS current_head INNER JOIN ${q("projection_set_publications")} AS current_publication ON current_publication.${q("id")} = current_head.${q("publication_id")} AND current_publication.${q("tenant_id")} = current_head.${q("tenant_id")} AND current_publication.${q("knowledge_space_id")} = current_head.${q("knowledge_space_id")} WHERE current_head.${q("tenant_id")} = ${p(1)} AND current_head.${q("knowledge_space_id")} = ${p(2)} AND ${sourceIdentityMetadataPredicateSql(database, `current_publication.${q("metadata")}`, true)} LIMIT 1;`,
      tableName: "projection_set_publications",
    });
    return publicationMetadata.rows.length > 0;
  }
  if (await hasOverviewResidue(database, executor, job)) return true;
  if (await hasTargetAnswerTraceOrEvidenceResidue(database, executor, job)) return true;
  if (job.targetType === "knowledge_space") {
    return hasKnowledgeSpaceExplicitCleanupResidue(database, executor, job);
  }
  if (await hasTargetDocumentForeignKeyResidue(database, executor, job)) return true;

  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId, job.targetId];
  const documentPredicate = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    false,
    1,
    2,
  ).replace("TARGET_DOCUMENT_ID ", "");
  const textDocumentPredicate = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    true,
    1,
    2,
  ).replace("TARGET_DOCUMENT_ID ", "");
  const semanticPathResidue = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT semantic_path.${q("id")} FROM ${q("knowledge_paths")} AS semantic_path WHERE semantic_path.${q("knowledge_space_id")} = ${p(1)} AND ${targetSemanticPathPredicateSql(database, documentPredicate, textDocumentPredicate)} LIMIT 1;`,
    tableName: "knowledge_paths",
  });
  if (semanticPathResidue.rows.length > 0) return true;
  for (const [table, column, targetPredicate, additionalPredicate] of [
    ["knowledge_nodes", "document_asset_id", documentPredicate, ""],
    ["page_index_manifests", "document_asset_id", documentPredicate, ""],
    ["document_outlines", "document_asset_id", documentPredicate, ""],
    ["document_multimodal_manifests", "document_asset_id", documentPredicate, ""],
    ["knowledge_space_staged_commits", "document_asset_id", documentPredicate, ""],
  ] as const) {
    const residue = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q(column)} ${targetPredicate}${additionalPredicate} LIMIT 1;`,
      tableName: table,
    });
    if (residue.rows.length > 0) return true;
  }

  for (const ledger of [
    {
      parentTable: "page_index_upgrade_backfills",
      parentIdColumn: "backfill_id",
      table: "page_index_upgrade_backfill_items",
    },
    {
      parentTable: "legacy_space_publication_bootstraps",
      parentIdColumn: "bootstrap_id",
      table: "legacy_space_publication_bootstrap_items",
    },
  ] as const) {
    const residue = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT ${q(ledger.parentIdColumn)} FROM ${q(ledger.table)} WHERE ${q(ledger.parentIdColumn)} IN (SELECT ${q("id")} FROM ${q(ledger.parentTable)} WHERE ${q("knowledge_space_id")} = ${p(1)}) AND ${q("document_asset_id")} ${documentPredicate} LIMIT 1;`,
      tableName: ledger.table,
    });
    if (residue.rows.length > 0) return true;
  }
  return false;
}

async function hasKnowledgeSpaceExplicitCleanupResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  for (const child of [
    {
      foreignKey: "attempt_id",
      parent: "document_compilation_attempts",
      table: "document_compilation_outbox",
    },
    { foreignKey: "trace_id", parent: "answer_traces", table: "answer_trace_steps" },
    { foreignKey: "manifest_id", parent: "page_index_manifests", table: "page_index_nodes" },
    {
      foreignKey: "research_task_job_id",
      parent: "research_task_jobs",
      table: "research_task_outbox",
    },
    { foreignKey: "run_id", parent: "quality_replay_runs", table: "quality_replay_items" },
    { foreignKey: "run_id", parent: "quality_replay_runs", table: "quality_replay_outbox" },
  ] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId],
      sql: `SELECT child.${q("id")} FROM ${q(child.table)} AS child WHERE child.${q(child.foreignKey)} IN (SELECT parent.${q("id")} FROM ${q(child.parent)} AS parent WHERE parent.${q("knowledge_space_id")} = ${p(1)}) LIMIT 1;`,
      tableName: child.table,
    });
    if (result.rows.length > 0) return true;
  }
  for (const ledger of [
    {
      foreignKey: "bootstrap_id",
      parent: "legacy_space_publication_bootstraps",
      table: "legacy_space_publication_bootstrap_items",
    },
    {
      foreignKey: "backfill_id",
      parent: "page_index_upgrade_backfills",
      table: "page_index_upgrade_backfill_items",
    },
  ] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId],
      sql: `SELECT child.${q(ledger.foreignKey)} FROM ${q(ledger.table)} AS child WHERE child.${q(ledger.foreignKey)} IN (SELECT parent.${q("id")} FROM ${q(ledger.parent)} AS parent WHERE parent.${q("knowledge_space_id")} = ${p(1)}) LIMIT 1;`,
      tableName: ledger.table,
    });
    if (result.rows.length > 0) return true;
  }
  const publicationMember = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.knowledgeSpaceId],
    sql: `SELECT ${q("publication_id")} FROM ${q("projection_set_publication_members")} WHERE ${q("knowledge_space_id")} = ${p(1)} LIMIT 1;`,
    tableName: "projection_set_publication_members",
  });
  if (publicationMember.rows.length > 0) return true;
  for (const table of KnowledgeSpaceExplicitCleanupTables) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [job.knowledgeSpaceId],
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("knowledge_space_id")} = ${p(1)} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  const parseArtifact = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.knowledgeSpaceId],
    sql: `SELECT artifact.${q("id")} FROM ${q("parse_artifacts")} AS artifact WHERE artifact.${q("document_asset_id")} IN (SELECT document.${q("id")} FROM ${q("document_assets")} AS document WHERE document.${q("knowledge_space_id")} = ${p(1)}) LIMIT 1;`,
    tableName: "parse_artifacts",
  });
  return parseArtifact.rows.length > 0;
}

async function hasTargetDocumentForeignKeyResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId, job.targetId];
  const documentPredicate = targetDocumentMembershipAtSql(
    database,
    job,
    "TARGET_DOCUMENT_ID",
    false,
    1,
    2,
  ).replace("TARGET_DOCUMENT_ID ", "");
  const queries = [
    {
      sql: `SELECT child.${q("id")} FROM ${q("document_compilation_outbox")} AS child WHERE child.${q("attempt_id")} IN (SELECT attempt.${q("id")} FROM ${q("document_compilation_attempts")} AS attempt WHERE attempt.${q("knowledge_space_id")} = ${p(1)} AND attempt.${q("document_asset_id")} ${documentPredicate}) LIMIT 1;`,
      table: "document_compilation_outbox",
    },
    {
      sql: `SELECT term.${q("id")} FROM ${q("page_index_terms")} AS term WHERE term.${q("knowledge_space_id")} = ${p(1)} AND term.${q("manifest_id")} IN (SELECT manifest.${q("id")} FROM ${q("page_index_manifests")} AS manifest WHERE manifest.${q("knowledge_space_id")} = ${p(1)} AND manifest.${q("document_asset_id")} ${documentPredicate}) LIMIT 1;`,
      table: "page_index_terms",
    },
    {
      sql: `SELECT child.${q("id")} FROM ${q("page_index_nodes")} AS child WHERE child.${q("manifest_id")} IN (SELECT manifest.${q("id")} FROM ${q("page_index_manifests")} AS manifest WHERE manifest.${q("knowledge_space_id")} = ${p(1)} AND manifest.${q("document_asset_id")} ${documentPredicate}) LIMIT 1;`,
      table: "page_index_nodes",
    },
    {
      sql: `SELECT posting.${q("id")} FROM ${q("index_projection_fts_postings")} AS posting WHERE posting.${q("knowledge_space_id")} = ${p(1)} AND posting.${q("projection_id")} IN (SELECT projection.${q("id")} FROM ${q("index_projections")} AS projection INNER JOIN ${q("knowledge_nodes")} AS node ON node.${q("id")} = projection.${q("node_id")} WHERE node.${q("knowledge_space_id")} = ${p(1)} AND node.${q("document_asset_id")} ${documentPredicate}) LIMIT 1;`,
      table: "index_projection_fts_postings",
    },
    {
      sql: `SELECT ${q("id")} FROM ${q("document_compilation_attempts")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("document_asset_id")} ${documentPredicate} LIMIT 1;`,
      table: "document_compilation_attempts",
    },
    {
      sql: `SELECT ${q("id")} FROM ${q("artifact_segments")} WHERE ${q("knowledge_space_id")} = ${p(1)} AND ${q("document_asset_id")} ${documentPredicate} LIMIT 1;`,
      table: "artifact_segments",
    },
    {
      sql: `SELECT artifact.${q("id")} FROM ${q("parse_artifacts")} AS artifact WHERE artifact.${q("document_asset_id")} ${documentPredicate} LIMIT 1;`,
      table: "parse_artifacts",
    },
  ] as const;
  for (const query of queries) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: query.sql,
      tableName: query.table,
    });
    if (result.rows.length > 0) return true;
  }
  return false;
}

async function hasRetrievalExecutionLeaseResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q("retrieval_execution_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
    tableName: "retrieval_execution_leases",
  });
  return result.rows.length > 0;
}

async function hasOpaqueSpaceResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
  table: "failed_queries" | "resource_mounts",
  hasTenantColumn: boolean,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: hasTenantColumn ? [job.tenantId, job.knowledgeSpaceId] : [job.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${hasTenantColumn ? `${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}` : `${q("knowledge_space_id")} = ${p(1)}`} LIMIT 1;`,
    tableName: table,
  });
  return result.rows.length > 0;
}

async function hasQualityControlResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  for (const table of [
    "quality_resource_history",
    "quality_bad_cases",
    "quality_missing_evidence_reviews",
    "quality_replay_runs",
  ] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  for (const table of ["quality_replay_items", "quality_replay_outbox"] as const) {
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT child.${q("id")} FROM ${q(table)} child INNER JOIN ${q("quality_replay_runs")} run ON run.${q("id")} = child.${q("run_id")} WHERE run.${q("tenant_id")} = ${p(1)} AND run.${q("knowledge_space_id")} = ${p(2)} LIMIT 1;`,
      tableName: table,
    });
    if (result.rows.length > 0) return true;
  }
  return false;
}

async function hasTargetAnswerTraceOrEvidenceResidue(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params = targetDocumentQueryParams(job);
  const traceAlias = "target_trace";
  const traceTargetPredicate =
    job.targetType === "knowledge_space"
      ? ""
      : ` AND ${targetTraceEvidencePredicateSql(database, job, traceAlias)}`;
  const traces = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${traceAlias}.${q("id")} FROM ${q("answer_traces")} AS ${traceAlias} WHERE ${traceAlias}.${q("knowledge_space_id")} = ${p(1)}${traceTargetPredicate} LIMIT 1;`,
    tableName: "answer_traces",
  });
  if (traces.rows.length > 0) return true;

  const bundleAlias = "target_bundle";
  const bundles = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${bundleAlias}.${q("id")} FROM ${q("evidence_bundles")} AS ${bundleAlias} WHERE ${targetEvidenceBundlePredicateSql(database, job, bundleAlias)} LIMIT 1;`,
    tableName: "evidence_bundles",
  });
  if (bundles.rows.length > 0) return true;

  const partialAlias = "target_research_partial";
  const evidenceBundleJson =
    database.dialect === "postgres"
      ? `${partialAlias}.${q("evidence_bundle")} -> 'items'`
      : `JSON_EXTRACT(${partialAlias}.${q("evidence_bundle")}, '$.items')`;
  const partials = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${partialAlias}.${q("id")} FROM ${q("research_task_partial_results")} AS ${partialAlias} WHERE ${partialAlias}.${q("knowledge_space_id")} = ${p(1)} AND ${targetEvidenceItemsPredicateSql(database, job, evidenceBundleJson)} LIMIT 1;`,
    tableName: "research_task_partial_results",
  });
  return partials.rows.length > 0;
}

async function deleteIds(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  table: string,
  column: string,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params: ids,
    sql: `DELETE FROM ${q(table)} WHERE ${q(column)} IN (${ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
    tableName: table,
  });
}

async function hasActiveCompilation(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "document_compilation_attempts",
    job,
    `run_state = 'running' AND lease_expires_at > CURRENT_TIMESTAMP`,
    true,
  );
}

async function hasActiveResearch(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "research_task_jobs",
    job,
    `lease_token IS NOT NULL AND lease_expires_at > ${Date.now()}`,
    false,
  );
}

async function hasActiveKnowledgeFsLease(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const leaseAlias = "target_lease";
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: targetKnowledgeFsLeaseParams(job),
    sql: `SELECT ${leaseAlias}.${q("id")} FROM ${q("knowledge_fs_leases")} AS ${leaseAlias} WHERE ${targetKnowledgeFsLeasePredicateSql(database, job, leaseAlias)} AND ${leaseAlias}.${q("status")} = 'active' AND ${leaseAlias}.${q("expires_at")} > CURRENT_TIMESTAMP LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  return result.rows.length > 0;
}

async function hasActiveKnowledgeFsSessionLease(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("status")} = 'active' AND ${q("expires_at")} > CURRENT_TIMESTAMP LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  return result.rows.length > 0;
}

function targetKnowledgeFsLeaseParams(
  job: DurableDeletionTargetOperationInput["job"],
): DatabaseQueryValue[] {
  return job.targetType === "knowledge_space"
    ? [job.tenantId, job.knowledgeSpaceId]
    : [job.tenantId, job.knowledgeSpaceId, job.targetId];
}

function targetKnowledgeFsLeasePredicateSql(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
  leaseAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const field = (column: string) => `${leaseAlias}.${q(column)}`;
  const scope = `${field("tenant_id")} = ${p(1)} AND ${field("knowledge_space_id")} = ${p(2)}`;
  if (job.targetType === "knowledge_space") return scope;

  const uuidDocumentMembership = (expression: string) =>
    targetDocumentMembershipAtSql(database, job, expression, false, 2, 3);
  const textDocumentId = (alias: string) =>
    database.dialect === "postgres"
      ? `CAST(${alias}.${q("id")} AS TEXT)`
      : `CAST(${alias}.${q("id")} AS CHAR(36))`;
  const textDocumentMembership = (expression: string) =>
    targetDocumentMembershipAtSql(database, job, expression, true, 2, 3);
  const uuidDocumentPredicate = uuidDocumentMembership("TARGET_DOCUMENT_ID").replace(
    "TARGET_DOCUMENT_ID ",
    "",
  );
  const textDocumentPredicate = textDocumentMembership("TARGET_DOCUMENT_ID").replace(
    "TARGET_DOCUMENT_ID ",
    "",
  );
  const metadataDocumentId =
    database.dialect === "postgres"
      ? `${field("metadata")} ->> 'documentAssetId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(${field("metadata")}, '$.documentAssetId'))`;
  const castId = (alias: string) =>
    database.dialect === "postgres"
      ? `CAST(${alias}.${q("id")} AS TEXT)`
      : `CAST(${alias}.${q("id")} AS CHAR(36))`;
  const documentVirtualPath = `EXISTS (SELECT 1 FROM ${q("document_assets")} AS target_document WHERE target_document.${q("knowledge_space_id")} = ${p(2)} AND ${field("virtual_path")} = CONCAT('/sources/documents/', ${textDocumentId("target_document")}) AND ${uuidDocumentMembership(`target_document.${q("id")}`)})`;
  const parseArtifactTarget = `${field("target_type")} = 'parse-artifact' AND ${field("target_id")} IN (SELECT ${castId("target_artifact")} FROM ${q("parse_artifacts")} AS target_artifact WHERE ${uuidDocumentMembership(`target_artifact.${q("document_asset_id")}`)})`;
  const projectionTarget = `${field("target_type")} = 'projection' AND ${field("target_id")} IN (SELECT ${castId("target_projection")} FROM ${q("index_projections")} AS target_projection INNER JOIN ${q("knowledge_nodes")} AS projection_node ON projection_node.${q("id")} = target_projection.${q("node_id")} WHERE projection_node.${q("knowledge_space_id")} = ${p(2)} AND ${uuidDocumentMembership(`projection_node.${q("document_asset_id")}`)})`;
  const pathTarget = `${field("target_type")} = 'knowledge-path' AND EXISTS (SELECT 1 FROM ${q("knowledge_paths")} AS target_path WHERE target_path.${q("knowledge_space_id")} = ${p(2)} AND (${field("target_id")} = ${castId("target_path")} OR ${field("target_id")} = target_path.${q("target_id")} OR ${field("virtual_path")} = target_path.${q("virtual_path")}) AND ${targetSemanticPathPredicateSql(database, uuidDocumentPredicate, textDocumentPredicate, 2, "target_path")})`;
  const stagedCommitTarget = `${field("target_type")} = 'staged-commit' AND EXISTS (SELECT 1 FROM ${q("knowledge_space_staged_commits")} AS target_commit WHERE target_commit.${q("tenant_id")} = ${p(1)} AND target_commit.${q("knowledge_space_id")} = ${p(2)} AND ${uuidDocumentMembership(`target_commit.${q("document_asset_id")}`)} AND (${field("target_id")} = ${castId("target_commit")} OR ${field("target_id")} = target_commit.${q("raw_object_key")} OR ${field("target_id")} = target_commit.${q("published_object_key")}))`;

  return `${scope} AND ((${field("target_type")} = 'knowledge-space' AND ${field("target_id")} = ${p(2)}) OR (${field("target_type")} = 'document-asset' AND ${textDocumentMembership(field("target_id"))}) OR ${documentVirtualPath} OR ${textDocumentMembership(metadataDocumentId)} OR (${parseArtifactTarget}) OR (${projectionTarget}) OR (${pathTarget}) OR (${stagedCommitTarget}))`;
}

async function hasActiveMutationLease(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "knowledge_space_mutation_leases",
    job,
    "expires_at > CURRENT_TIMESTAMP",
    false,
  );
}

async function hasActiveLegacyBootstrap(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "legacy_space_publication_bootstraps",
    job,
    `run_state = 'running' AND lease_expires_at > CURRENT_TIMESTAMP`,
    false,
  );
}

async function hasActivePageIndexBackfill(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "page_index_upgrade_backfills",
    job,
    `run_state = 'running' AND lease_expires_at > CURRENT_TIMESTAMP`,
    false,
  );
}

async function hasActiveTidbFtsBackfill(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "tidb_fts_posting_backfills",
    job,
    `run_state = 'running' AND lease_expires_at > CURRENT_TIMESTAMP`,
    false,
  );
}

async function hasActiveSourceCredentialBackfill(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  let target = "";
  if (job.targetType === "source") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} = ${p(3)}`;
  } else if (job.targetType === "document_asset") {
    params.push(job.targetId);
    target = ` AND ${q("source_id")} IN (SELECT ${q("source_id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("source_id")} IS NOT NULL)`;
  }
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q("source_credential_backfills")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)}${target} AND ${q("run_state")} = 'running' AND ${q("lease_expires_at")} > CURRENT_TIMESTAMP LIMIT 1;`,
    tableName: "source_credential_backfills",
  });
  return result.rows.length > 0;
}

async function hasActiveStagedCommit(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(
    database,
    "knowledge_space_staged_commits",
    job,
    `status NOT IN ('published', 'failed-terminal', 'canceled', 'gc-complete')`,
    true,
  );
}

async function hasActiveSourceSync(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
) {
  return hasScopedRow(database, "sources", job, `status = 'syncing'`, false);
}

async function hasActiveSourceProductWorkflow(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  if (job.targetType !== "knowledge_space" && job.targetType !== "source") return false;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  if (job.targetType === "source") params.push(job.targetId);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT source_workflow_runs.${q("id")} FROM ${q("source_workflow_runs")} source_workflow_runs WHERE ${sourceWorkflowRunScopeSql(database, job, "source_workflow_runs", 1, 2, 3)} AND source_workflow_runs.${q("run_state")} IN ('queued', 'running', 'crawling', 'preview_ready', 'importing', 'syncing') LIMIT 1;`,
    tableName: "source_workflow_runs",
  });
  return result.rows.length > 0;
}

async function hasPendingSourceConnectionSecretCleanup(
  database: DatabaseAdapter,
  job: DurableDeletionTargetOperationInput["job"],
): Promise<boolean> {
  if (job.targetType !== "knowledge_space") return false;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT ${q("id")} FROM ${q("source_connection_secret_refs")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("state")} <> 'deleted' LIMIT 1;`,
    tableName: "source_connection_secret_refs",
  });
  return result.rows.length > 0;
}

async function hasScopedRow(
  database: DatabaseAdapter,
  table: string,
  job: DurableDeletionTargetOperationInput["job"],
  rawPredicate: string,
  hasDocumentColumn: boolean,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = [job.tenantId, job.knowledgeSpaceId];
  let target = "";
  if (job.targetType === "document_asset" && table === "sources") {
    params.push(job.targetId);
    target = ` AND ${q("id")} IN (SELECT ${q("source_id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("source_id")} IS NOT NULL)`;
  } else if (job.targetType === "document_asset" && hasDocumentColumn) {
    params.push(job.targetId);
    target = ` AND ${q("document_asset_id")} = ${p(3)}`;
  } else if (job.targetType === "source" && table === "sources") {
    params.push(job.targetId);
    target = ` AND ${q("id")} = ${p(3)}`;
  } else if (job.targetType === "source" && hasDocumentColumn) {
    params.push(job.targetId);
    target = ` AND ${q("document_asset_id")} IN (SELECT ${q("id")} FROM ${q("document_assets")} WHERE ${q("knowledge_space_id")} = ${p(2)} AND ${q("source_id")} = ${p(3)})`;
  } else if (job.targetType === "logical_document" && table === "sources") {
    params.push(job.targetId);
    target = ` AND ${q("id")} IN (SELECT ${q("source_id")} FROM ${q("logical_documents")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("id")} = ${p(3)} AND ${q("source_id")} IS NOT NULL)`;
  } else if (job.targetType === "logical_document" && hasDocumentColumn) {
    params.push(job.targetId);
    target = ` AND ${targetDocumentMembershipAtSql(database, job, q("document_asset_id"), false, 2, 3)}`;
  }
  const tenantPredicate = [
    "document_compilation_attempts",
    "research_task_jobs",
    "knowledge_space_staged_commits",
    "knowledge_fs_leases",
    "knowledge_space_mutation_leases",
    "legacy_space_publication_bootstraps",
    "page_index_upgrade_backfills",
    "tidb_fts_posting_backfills",
  ].includes(table)
    ? `${q("tenant_id")} = ${p(1)} AND `
    : `EXISTS (SELECT 1 FROM ${q("knowledge_spaces")} scope_space WHERE scope_space.${q("tenant_id")} = ${p(1)} AND scope_space.${q("id")} = ${p(2)}) AND `;
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${tenantPredicate}${q("knowledge_space_id")} = ${p(2)}${target} AND ${rawPredicate} LIMIT 1;`,
    tableName: table,
  });
  return result.rows.length > 0;
}

function objectInventoryItem(objectKey: string, ordinal: number, maxAttempts: number) {
  return {
    idempotencyKey: digestKey("object", objectKey),
    kind: "object" as const,
    maxAttempts,
    objectKey,
    ordinal,
  };
}

function inventoryPage(
  items: DurableDeletionInventoryPage["items"],
  complete: boolean,
  cursor: InventoryCursor,
): DurableDeletionInventoryPage {
  return {
    complete,
    items,
    nextCursor: encodeInventoryCursor(cursor),
    scanPhase: cursor.phase,
  };
}

function inventoryComplete(
  ordinal: number,
  phase: InventoryCursor["phase"],
): DurableDeletionInventoryPage {
  return { complete: true, items: [], scanPhase: `${phase}:${ordinal}` };
}

function decodeInventoryCursor(
  value: string | undefined,
  job: DurableDeletionTargetOperationInput["job"],
): InventoryCursor {
  if (!value) {
    return {
      ordinal: 1,
      phase:
        job.targetType === "knowledge_space"
          ? "space_objects"
          : job.targetType === "source" && job.deleteMode === "keep"
            ? "lifecycle_secrets"
            : "document_objects",
    };
  }
  try {
    if (value.length > 1024) throw new Error();
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const parsed = {
      ...raw,
      phase: raw.phase === "secrets" ? "lifecycle_secrets" : raw.phase,
    } as unknown as InventoryCursor;
    if (!Number.isSafeInteger(parsed.ordinal) || parsed.ordinal < 1) throw new Error();
    if (
      !["document_objects", "lifecycle_secrets", "source_secrets", "space_objects"].includes(
        parsed.phase,
      )
    ) {
      throw new Error();
    }
    for (const field of [
      "activeDocumentId",
      "databaseKeyCursor",
      "documentAfter",
      "lifecycleCursor",
      "manifestActiveId",
      "manifestAfter",
      "objectCursor",
      "sourceCursor",
    ] as const) {
      const fieldValue = parsed[field];
      if (
        fieldValue !== undefined &&
        (typeof fieldValue !== "string" || fieldValue.length < 1 || fieldValue.length > 1024)
      ) {
        throw new Error();
      }
    }
    if (
      parsed.documentScan !== undefined &&
      !["artifacts", "manifests", "raw", "staged", "storage"].includes(parsed.documentScan)
    ) {
      throw new Error();
    }
    if (
      parsed.manifestKeyOffset !== undefined &&
      (!Number.isSafeInteger(parsed.manifestKeyOffset) || parsed.manifestKeyOffset < 0)
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error("Durable deletion inventory cursor is invalid");
  }
}

function encodeInventoryCursor(value: InventoryCursor): string {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  if (encoded.length > 1024) throw new Error("Durable deletion inventory cursor exceeds bound");
  return encoded;
}

function validateObjectKeys(
  values: readonly string[],
  requiredPrefix: string,
  limit: number,
): readonly string[] {
  if (values.length > limit || new Set(values).size !== values.length) {
    throw new Error("Durable deletion object inventory page is unbounded or duplicated");
  }
  for (const value of values) {
    if (!value || value.length > 1024 || !value.startsWith(requiredPrefix)) {
      throw new Error("Durable deletion object key escapes the immutable space prefix");
    }
  }
  return values;
}

function validateObjectStoragePage(
  page: ListObjectsResult,
  currentCursor: string | undefined,
  requiredPrefix: string,
  limit: number,
): readonly string[] {
  const keys = validateObjectKeys(
    page.objects.map((object) => object.key),
    requiredPrefix,
    limit,
  );
  if (
    page.nextCursor !== undefined &&
    (!page.nextCursor ||
      page.nextCursor.length > 1024 ||
      page.nextCursor === currentCursor ||
      keys.length === 0)
  ) {
    throw new Error("Durable deletion object storage cursor did not make bounded progress");
  }
  return keys;
}

function digestKey(kind: string, value: string): string {
  return `${kind}:${createHash("sha256").update(value).digest("hex")}`;
}

function deletionPublicationFingerprint(jobId: string, publicationId: string): string {
  const digest = createHash("sha256")
    .update(`durable-deletion-publication-v1\0${jobId}\0${publicationId}`)
    .digest("hex");
  return `projection-set-sha256:${digest}`;
}

function numericColumn(row: DatabaseRow, column: string): number {
  const value = row[column];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${column}`);
  return parsed;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Durable deletion operation aborted");
}
