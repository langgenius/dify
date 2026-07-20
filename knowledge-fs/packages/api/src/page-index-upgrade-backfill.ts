import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  type DocumentOutline,
  DocumentOutlineSchema,
  ProjectionSetFingerprintSchema,
  PublicationGenerationIdSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { PageIndexTokenizerVersion } from "./page-index-scoring";
import type { PublishedProjectionReadinessGate } from "./published-projection-read-snapshot";

export const PageIndexUpgradeBackfillRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "superseded",
] as const;
export type PageIndexUpgradeBackfillRunState = (typeof PageIndexUpgradeBackfillRunStates)[number];

export interface PageIndexUpgradeBackfill {
  readonly completedAt?: string | undefined;
  readonly completedItems: number;
  readonly createdAt: string;
  readonly headRevision: number;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly publicationFingerprint: string;
  readonly publicationId: string;
  readonly retryCount: number;
  readonly rowVersion: number;
  readonly runState: PageIndexUpgradeBackfillRunState;
  readonly tenantId: string;
  readonly totalItems: number;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface PageIndexUpgradeBackfillItem {
  readonly backfillId: string;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentOutlineId: string;
  readonly documentVersion: number;
  readonly ordinal: number;
  readonly publicationGenerationId: string;
  readonly status: "pending" | "succeeded";
  readonly updatedAt: string;
}

export interface PageIndexUpgradeBackfillWorkItem {
  readonly item: PageIndexUpgradeBackfillItem;
  readonly outline: DocumentOutline;
}

export interface PageIndexUpgradeBackfillLookupInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ClaimPageIndexUpgradeBackfillsInput {
  readonly leaseExpiresAt: string;
  readonly limit: number;
  readonly now: string;
  readonly workerId: string;
}

export interface PageIndexUpgradeBackfillFence {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface PageIndexUpgradeBackfillHeartbeatInput extends PageIndexUpgradeBackfillFence {
  readonly leaseExpiresAt: string;
  readonly workerId: string;
}

export interface PageIndexUpgradeBackfillRepository extends PublishedProjectionReadinessGate {
  claim(input: ClaimPageIndexUpgradeBackfillsInput): Promise<readonly PageIndexUpgradeBackfill[]>;
  complete(input: PageIndexUpgradeBackfillFence): Promise<PageIndexUpgradeBackfill | null>;
  ensureCurrentHead(
    input: PageIndexUpgradeBackfillLookupInput & { readonly now: string },
  ): Promise<PageIndexUpgradeBackfill | null>;
  fail(
    input: PageIndexUpgradeBackfillFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<PageIndexUpgradeBackfill | null>;
  get(input: PageIndexUpgradeBackfillLookupInput): Promise<PageIndexUpgradeBackfill | null>;
  getNextItem(
    input: PageIndexUpgradeBackfillFence,
  ): Promise<PageIndexUpgradeBackfillWorkItem | null>;
  heartbeat(
    input: PageIndexUpgradeBackfillHeartbeatInput,
  ): Promise<PageIndexUpgradeBackfill | null>;
  markItemSucceeded(
    input: PageIndexUpgradeBackfillFence & { readonly documentOutlineId: string },
  ): Promise<PageIndexUpgradeBackfill | null>;
  release(input: PageIndexUpgradeBackfillFence): Promise<PageIndexUpgradeBackfill | null>;
  retry(
    input: PageIndexUpgradeBackfillLookupInput & { readonly now: string },
  ): Promise<PageIndexUpgradeBackfill | null>;
}

export interface DatabasePageIndexUpgradeBackfillRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly maxItemsPerJob: number;
}

export class PageIndexUpgradeBackfillTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageIndexUpgradeBackfillTransitionError";
  }
}

export class PageIndexUpgradeBackfillVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageIndexUpgradeBackfillVerificationError";
  }
}

const jobTable = "page_index_upgrade_backfills";
const itemTable = "page_index_upgrade_backfill_items";
const headTable = "projection_set_publication_heads";
const publicationTable = "projection_set_publications";
const memberTable = "projection_set_publication_members";
const outlineTable = "document_outlines";
const manifestTable = "page_index_manifests";
const nodeTable = "page_index_nodes";
const termTable = "page_index_terms";

/**
 * Durable one-time upgrade repository. Every job is permanently bound to a publication id,
 * fingerprint, head revision, and exact outline/generation/asset/version item set. All state
 * transitions use a lease token plus row-version fence.
 */
export function createDatabasePageIndexUpgradeBackfillRepository({
  database,
  generateLeaseToken = randomUUID,
  maxClaimBatchSize,
  maxItemsPerJob,
}: DatabasePageIndexUpgradeBackfillRepositoryOptions): PageIndexUpgradeBackfillRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxItemsPerJob, "maxItemsPerJob");

  return {
    claim: async (rawInput) => {
      const input = normalizeClaim(rawInput, maxClaimBatchSize);
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params: [input.now, input.limit],
          sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(
            database,
            "run_state",
          )} = 'queued' OR (${q(database, "run_state")} = 'running' AND ${q(
            database,
            "lease_expires_at",
          )} <= ${p(database, 1)}) ORDER BY ${q(database, "updated_at")} ASC, ${q(
            database,
            "id",
          )} ASC LIMIT ${p(database, 2)} FOR UPDATE${
            database.dialect === "postgres" ? " SKIP LOCKED" : ""
          };`,
          tableName: jobTable,
        });
        const claimed: PageIndexUpgradeBackfill[] = [];
        for (const row of selected.rows) {
          const current = mapJob(row);
          const leaseToken = PublicationGenerationIdSchema.parse(generateLeaseToken());
          const next = await persistJob(database, transaction, current, {
            ...current,
            completedAt: undefined,
            heartbeatAt: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
            leaseToken,
            rowVersion: current.rowVersion + 1,
            runState: "running",
            updatedAt: input.now,
            workerId: input.workerId,
          });
          claimed.push(next);
        }
        return claimed;
      });
    },

    complete: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const preview = await getJobById(database, transaction, fence.jobId, false);
        if (!preview) {
          throw new PageIndexUpgradeBackfillTransitionError("PageIndex upgrade job was not found");
        }
        await lockSpace(database, transaction, preview);
        const head = await loadCurrentHead(database, transaction, preview, true);
        const current = await requireFencedJob(database, transaction, fence);
        if (
          !head ||
          head.publicationId !== current.publicationId ||
          head.fingerprint !== current.publicationFingerprint ||
          head.headRevision !== current.headRevision
        ) {
          const superseded = await persistJob(database, transaction, current, {
            ...withoutLease(current),
            completedAt: fence.now,
            lastErrorCode: "HEAD_CHANGED",
            lastErrorMessage: "Published head changed before PageIndex upgrade cutover",
            rowVersion: current.rowVersion + 1,
            runState: "superseded",
            updatedAt: fence.now,
          });
          if (head) {
            await ensureHeadJob({
              database,
              head,
              maxItemsPerJob,
              now: fence.now,
              transaction,
            });
          }
          return superseded;
        }

        await verifyFrozenItems(database, transaction, current);
        if (
          await hasInvalidPageIndexClosure(database, transaction, current, {
            readyOnly: false,
          })
        ) {
          throw new PageIndexUpgradeBackfillVerificationError(
            "Frozen published head has an incomplete PageIndex closure",
          );
        }

        await promoteFrozenManifests(database, transaction, current, fence.now);

        if (
          await hasInvalidPageIndexClosure(database, transaction, current, {
            readyOnly: true,
          })
        ) {
          throw new PageIndexUpgradeBackfillVerificationError(
            "PageIndex closure did not become fully ready atomically",
          );
        }

        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: fence.now,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          rowVersion: current.rowVersion + 1,
          runState: "succeeded",
          updatedAt: fence.now,
        });
      });
    },

    ensureCurrentHead: async (rawInput) => {
      const input = normalizeScopeWithNow(rawInput);
      return database.transaction(async (transaction) => {
        await lockSpace(database, transaction, input);
        const head = await loadCurrentHead(database, transaction, input, true);
        return head
          ? ensureHeadJob({ database, head, maxItemsPerJob, now: input.now, transaction })
          : null;
      });
    },

    fail: async (rawInput) => {
      const input = {
        ...normalizeFence(rawInput),
        errorCode: requiredString(rawInput.errorCode, "errorCode", 64),
        errorMessage: requiredString(rawInput.errorMessage, "errorMessage", 16_384),
      };
      return database.transaction(async (transaction) => {
        const current = await requireFencedJob(database, transaction, input);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: input.now,
          lastErrorCode: input.errorCode,
          lastErrorMessage: input.errorMessage,
          rowVersion: current.rowVersion + 1,
          runState: "failed",
          updatedAt: input.now,
        });
      });
    },

    get: async (rawInput) => {
      const input = normalizeScope(rawInput);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId],
        sql: `SELECT job.* FROM ${q(database, headTable)} head JOIN ${q(
          database,
          jobTable,
        )} job ON job.${q(database, "tenant_id")} = head.${q(
          database,
          "tenant_id",
        )} AND job.${q(database, "knowledge_space_id")} = head.${q(
          database,
          "knowledge_space_id",
        )} AND job.${q(database, "publication_id")} = head.${q(
          database,
          "publication_id",
        )} WHERE head.${q(database, "tenant_id")} = ${p(database, 1)} AND head.${q(
          database,
          "knowledge_space_id",
        )} = ${p(database, 2)} LIMIT 1;`,
        tableName: jobTable,
      });
      return result.rows[0] ? mapJob(result.rows[0]) : null;
    },

    getNextItem: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const current = await requireFencedJob(database, transaction, fence);
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id, current.knowledgeSpaceId],
          sql: `${outlineSelect(database)} FROM ${q(database, itemTable)} item JOIN ${q(
            database,
            outlineTable,
          )} outline_row ON outline_row.${q(database, "id")} = item.${q(
            database,
            "document_outline_id",
          )} AND outline_row.${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} AND outline_row.${q(database, "publication_generation_id")} = item.${q(
            database,
            "publication_generation_id",
          )} AND outline_row.${q(database, "document_asset_id")} = item.${q(
            database,
            "document_asset_id",
          )} AND outline_row.${q(database, "version")} = item.${q(
            database,
            "document_version",
          )} WHERE item.${q(database, "backfill_id")} = ${p(
            database,
            1,
          )} AND item.${q(database, "status")} = 'pending' ORDER BY item.${q(
            database,
            "ordinal",
          )} ASC, item.${q(database, "document_outline_id")} ASC LIMIT 1 FOR UPDATE;`,
          tableName: itemTable,
        });
        const row = result.rows[0];
        if (row) {
          return { item: mapItem(row), outline: mapOutline(row) };
        }

        // A missing outline cannot be mistaken for an empty/completed item set.
        const pending = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id],
          sql: `SELECT ${q(database, "document_outline_id")} FROM ${q(
            database,
            itemTable,
          )} WHERE ${q(database, "backfill_id")} = ${p(database, 1)} AND ${q(
            database,
            "status",
          )} = 'pending' LIMIT 1;`,
          tableName: itemTable,
        });
        if (pending.rows[0]) {
          throw new PageIndexUpgradeBackfillVerificationError(
            "Frozen PageIndex backfill outline closure is missing",
          );
        }
        return null;
      });
    },

    heartbeat: async (rawInput) => {
      const input = normalizeHeartbeat(rawInput);
      return database.transaction(async (transaction) => {
        const preview = await getJobById(database, transaction, input.jobId, false);
        if (!preview) return null;
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, input);
        if (current.workerId !== input.workerId) {
          return null;
        }
        return persistJob(database, transaction, current, {
          ...current,
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
        });
      });
    },

    isQueryReady: async (rawInput) => {
      if (rawInput.resolvedMode !== "research") {
        return true;
      }
      const input = normalizeScope(rawInput);
      const head = await loadCurrentHead(database, database, input, false);
      if (!head) {
        return false;
      }
      const job = await getJobById(database, database, head.publicationId, false);
      if (job) {
        return job.runState === "succeeded";
      }
      // Migration 0010 creates a ledger for every incomplete pre-upgrade head. A later head is
      // published only after the ordinary publication transaction validates PageIndex closure.
      // For a no-ledger head, keep the read path bounded to indexed member -> ready-manifest
      // existence; expensive child-count/term closure validation belongs to migration/cutover.
      return !(await hasMissingReadyManifest(database, database, head));
    },

    markItemSucceeded: async (rawInput) => {
      const input = {
        ...normalizeFence(rawInput),
        documentOutlineId: UuidSchema.parse(rawInput.documentOutlineId),
      };
      return database.transaction(async (transaction) => {
        const preview = await getJobById(database, transaction, input.jobId, false);
        if (!preview) return null;
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, input);
        const selected = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id, input.documentOutlineId],
          sql: `SELECT * FROM ${q(database, itemTable)} WHERE ${q(
            database,
            "backfill_id",
          )} = ${p(database, 1)} AND ${q(database, "document_outline_id")} = ${p(
            database,
            2,
          )} LIMIT 1 FOR UPDATE;`,
          tableName: itemTable,
        });
        if (!selected.rows[0]) {
          throw new PageIndexUpgradeBackfillTransitionError("Frozen backfill item was not found");
        }
        const item = mapItem(selected.rows[0]);
        if (item.status === "succeeded") {
          return current;
        }
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.now, current.id, input.documentOutlineId],
          sql: `UPDATE ${q(database, itemTable)} SET ${q(
            database,
            "status",
          )} = 'succeeded', ${q(database, "updated_at")} = ${p(
            database,
            1,
          )} WHERE ${q(database, "backfill_id")} = ${p(database, 2)} AND ${q(
            database,
            "document_outline_id",
          )} = ${p(database, 3)} AND ${q(database, "status")} = 'pending';`,
          tableName: itemTable,
        });
        if (updated.rowsAffected !== 1) {
          throw new PageIndexUpgradeBackfillTransitionError(
            "Frozen backfill item changed before completion",
          );
        }
        return persistJob(database, transaction, current, {
          ...current,
          completedItems: current.completedItems + 1,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
        });
      });
    },

    release: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const preview = await getJobById(database, transaction, fence.jobId, false);
        if (!preview) return null;
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, fence);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: fence.now,
        });
      });
    },

    retry: async (rawInput) => {
      const input = normalizeScopeWithNow(rawInput);
      return database.transaction(async (transaction) => {
        await lockSpace(database, transaction, input);
        const head = await loadCurrentHead(database, transaction, input, true);
        if (!head) {
          return null;
        }
        const current = await getJobById(database, transaction, head.publicationId, true);
        if (!current) {
          return ensureHeadJob({ database, head, maxItemsPerJob, now: input.now, transaction });
        }
        if (current.runState === "succeeded") {
          return current;
        }
        if (current.runState !== "failed") {
          throw new PageIndexUpgradeBackfillTransitionError(
            `PageIndex upgrade cannot retry from state=${current.runState}`,
          );
        }
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          retryCount: current.retryCount + 1,
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: input.now,
        });
      });
    },
  };
}

interface FrozenHead extends PageIndexUpgradeBackfillLookupInput {
  readonly fingerprint: string;
  readonly headRevision: number;
  readonly publicationId: string;
}

async function ensureHeadJob(input: {
  readonly database: DatabaseAdapter;
  readonly head: FrozenHead;
  readonly maxItemsPerJob: number;
  readonly now: string;
  readonly transaction: DatabaseExecutor;
}): Promise<PageIndexUpgradeBackfill | null> {
  const { database, head, maxItemsPerJob, now, transaction } = input;
  const existing = await getJobById(database, transaction, head.publicationId, true);
  if (existing) {
    return existing;
  }
  if (!(await hasInvalidPageIndexClosure(database, transaction, head, { readyOnly: true }))) {
    return null;
  }

  const outlineRows = await transaction.execute({
    maxRows: maxItemsPerJob + 1,
    operation: "select",
    params: [head.tenantId, head.knowledgeSpaceId, head.publicationId, maxItemsPerJob + 1],
    sql: `SELECT pm.${q(database, "component_key")} AS ${q(
      database,
      "document_outline_id",
    )}, pm.${q(database, "generation_id")} AS ${q(
      database,
      "publication_generation_id",
    )}, pm.${q(database, "document_asset_id")} AS ${q(
      database,
      "document_asset_id",
    )}, outline_row.${q(database, "version")} AS ${q(
      database,
      "document_version",
    )} FROM ${q(database, memberTable)} pm LEFT JOIN ${q(
      database,
      outlineTable,
    )} outline_row ON outline_row.${q(database, "id")} = pm.${q(
      database,
      "component_key",
    )} AND outline_row.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND outline_row.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND outline_row.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} WHERE pm.${q(database, "tenant_id")} = ${p(database, 1)} AND pm.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND pm.${q(database, "publication_id")} = ${p(
      database,
      3,
    )} AND pm.${q(database, "component_type")} = 'document-outline' ORDER BY pm.${q(
      database,
      "component_key",
    )} ASC, pm.${q(database, "generation_id")} ASC LIMIT ${p(database, 4)};`,
    tableName: memberTable,
  });
  if (outlineRows.rows.length > maxItemsPerJob) {
    throw new PageIndexUpgradeBackfillVerificationError(
      `PageIndex upgrade exceeds maxItemsPerJob=${maxItemsPerJob}`,
    );
  }
  // Keep a durable failed marker even for broken member -> outline closure. This avoids a
  // missing-row defect being mistaken for a zero-item success.
  const items = outlineRows.rows.flatMap((row, ordinal) => {
    const outlineId = UuidSchema.parse(stringColumn(row, "document_outline_id"));
    const generationId = PublicationGenerationIdSchema.parse(
      stringColumn(row, "publication_generation_id"),
    );
    const assetId = optionalStringColumn(row, "document_asset_id");
    const version = row.document_version;
    if (!assetId || typeof version !== "number") {
      return [];
    }
    return [
      {
        backfillId: head.publicationId,
        createdAt: now,
        documentAssetId: UuidSchema.parse(assetId),
        documentOutlineId: outlineId,
        documentVersion: version,
        ordinal,
        publicationGenerationId: generationId,
        status: "pending" as const,
        updatedAt: now,
      },
    ];
  });
  const job: PageIndexUpgradeBackfill = {
    completedItems: 0,
    createdAt: now,
    headRevision: head.headRevision,
    id: head.publicationId,
    knowledgeSpaceId: head.knowledgeSpaceId,
    publicationFingerprint: head.fingerprint,
    publicationId: head.publicationId,
    retryCount: 0,
    rowVersion: 0,
    runState: "queued",
    tenantId: head.tenantId,
    totalItems: outlineRows.rows.length,
    updatedAt: now,
  };
  await insertJob(database, transaction, job);
  for (const item of items) {
    await insertItem(database, transaction, item);
  }
  return job;
}

async function verifyFrozenItems(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: PageIndexUpgradeBackfill,
): Promise<void> {
  const count = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT COUNT(*) AS ${q(database, "item_count")}, SUM(CASE WHEN ${q(
      database,
      "status",
    )} = 'succeeded' THEN 1 ELSE 0 END) AS ${q(database, "succeeded_count")} FROM ${q(
      database,
      itemTable,
    )} WHERE ${q(database, "backfill_id")} = ${p(database, 1)};`,
    tableName: itemTable,
  });
  const row = count.rows[0];
  if (
    !row ||
    numberColumn(row, "item_count") !== job.totalItems ||
    numberColumn(row, "succeeded_count") !== job.totalItems ||
    job.completedItems !== job.totalItems
  ) {
    throw new PageIndexUpgradeBackfillVerificationError(
      "PageIndex upgrade cannot complete before every frozen item succeeds",
    );
  }

  const mismatch = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id, job.tenantId, job.knowledgeSpaceId, job.publicationId],
    sql: `SELECT item.${q(database, "document_outline_id")} FROM ${q(
      database,
      itemTable,
    )} item LEFT JOIN ${q(database, memberTable)} pm ON pm.${q(
      database,
      "tenant_id",
    )} = ${p(database, 2)} AND pm.${q(database, "knowledge_space_id")} = ${p(
      database,
      3,
    )} AND pm.${q(database, "publication_id")} = ${p(database, 4)} AND pm.${q(
      database,
      "component_type",
    )} = 'document-outline' AND pm.${q(database, "component_key")} = item.${q(
      database,
      "document_outline_id",
    )} AND pm.${q(database, "generation_id")} = item.${q(
      database,
      "publication_generation_id",
    )} AND pm.${q(database, "document_asset_id")} = item.${q(
      database,
      "document_asset_id",
    )} LEFT JOIN ${q(database, outlineTable)} outline_row ON outline_row.${q(
      database,
      "id",
    )} = item.${q(database, "document_outline_id")} AND outline_row.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 3)} AND outline_row.${q(
      database,
      "publication_generation_id",
    )} = item.${q(database, "publication_generation_id")} AND outline_row.${q(
      database,
      "document_asset_id",
    )} = item.${q(database, "document_asset_id")} AND outline_row.${q(
      database,
      "version",
    )} = item.${q(database, "document_version")} WHERE item.${q(
      database,
      "backfill_id",
    )} = ${p(database, 1)} AND (pm.${q(database, "component_key")} IS NULL OR outline_row.${q(
      database,
      "id",
    )} IS NULL) LIMIT 1;`,
    tableName: itemTable,
  });
  if (mismatch.rows[0]) {
    throw new PageIndexUpgradeBackfillVerificationError(
      "Frozen PageIndex item no longer matches its immutable publication closure",
    );
  }
}

async function hasInvalidPageIndexClosure(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: FrozenHead | PageIndexUpgradeBackfill,
  options: { readonly readyOnly: boolean },
): Promise<boolean> {
  const statusSql = options.readyOnly
    ? "manifest.status = 'ready'"
    : "manifest.status IN ('building', 'ready')";
  const checksumSql =
    database.dialect === "postgres"
      ? "manifest.checksum ~ '^[0-9a-f]{64}$'"
      : "manifest.checksum REGEXP '^[0-9a-f]{64}$'";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.publicationId],
    sql: `SELECT pm.${q(database, "component_key")} FROM ${q(
      database,
      memberTable,
    )} pm LEFT JOIN ${q(database, outlineTable)} outline_row ON outline_row.${q(
      database,
      "id",
    )} = pm.${q(database, "component_key")} AND outline_row.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND outline_row.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} AND outline_row.${q(
      database,
      "document_asset_id",
    )} = pm.${q(database, "document_asset_id")} LEFT JOIN ${q(
      database,
      manifestTable,
    )} manifest ON manifest.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND manifest.${q(database, "document_outline_id")} = pm.${q(
      database,
      "component_key",
    )} AND manifest.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND manifest.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} AND manifest.${q(database, "document_version")} = outline_row.${q(
      database,
      "version",
    )} AND manifest.${q(database, "tokenizer_version")} = '${PageIndexTokenizerVersion}' AND ${statusSql} WHERE pm.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND pm.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND pm.${q(database, "publication_id")} = ${p(database, 3)} AND pm.${q(
      database,
      "component_type",
    )} = 'document-outline' AND (pm.${q(
      database,
      "generation_id",
    )} = '${"00000000-0000-0000-0000-000000000000"}' OR outline_row.${q(
      database,
      "id",
    )} IS NULL OR manifest.${q(database, "id")} IS NULL OR NOT (${checksumSql}) OR manifest.${q(
      database,
      "node_count",
    )} <= 0 OR manifest.${q(database, "term_count")} <= 0 OR manifest.${q(
      database,
      "node_count",
    )} <> (SELECT COUNT(*) FROM ${q(database, nodeTable)} node_row WHERE node_row.${q(
      database,
      "manifest_id",
    )} = manifest.${q(database, "id")}) OR manifest.${q(
      database,
      "term_count",
    )} <> (SELECT COUNT(*) FROM ${q(database, termTable)} term_row WHERE term_row.${q(
      database,
      "manifest_id",
    )} = manifest.${q(database, "id")}) OR EXISTS (SELECT 1 FROM ${q(
      database,
      termTable,
    )} term_row LEFT JOIN ${q(database, nodeTable)} node_row ON node_row.${q(
      database,
      "id",
    )} = term_row.${q(database, "page_index_node_id")} AND node_row.${q(
      database,
      "manifest_id",
    )} = term_row.${q(database, "manifest_id")} WHERE term_row.${q(
      database,
      "manifest_id",
    )} = manifest.${q(database, "id")} AND (term_row.${q(
      database,
      "knowledge_space_id",
    )} <> pm.${q(database, "knowledge_space_id")} OR node_row.${q(
      database,
      "id",
    )} IS NULL))) LIMIT 1;`,
    tableName: memberTable,
  });
  return Boolean(result.rows[0]);
}

async function hasMissingReadyManifest(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: FrozenHead,
): Promise<boolean> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.publicationId],
    sql: `SELECT pm.${q(database, "component_key")} FROM ${q(
      database,
      memberTable,
    )} pm LEFT JOIN ${q(database, outlineTable)} outline_row ON outline_row.${q(
      database,
      "id",
    )} = pm.${q(database, "component_key")} AND outline_row.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND outline_row.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} AND outline_row.${q(
      database,
      "document_asset_id",
    )} = pm.${q(database, "document_asset_id")} LEFT JOIN ${q(
      database,
      manifestTable,
    )} manifest ON manifest.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND manifest.${q(database, "document_outline_id")} = pm.${q(
      database,
      "component_key",
    )} AND manifest.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND manifest.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} AND manifest.${q(database, "document_version")} = outline_row.${q(
      database,
      "version",
    )} AND manifest.${q(database, "tokenizer_version")} = '${PageIndexTokenizerVersion}' AND manifest.${q(
      database,
      "status",
    )} = 'ready' WHERE pm.${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND pm.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND pm.${q(database, "publication_id")} = ${p(database, 3)} AND pm.${q(
      database,
      "component_type",
    )} = 'document-outline' AND (outline_row.${q(
      database,
      "id",
    )} IS NULL OR manifest.${q(database, "id")} IS NULL) LIMIT 1;`,
    tableName: memberTable,
  });
  return Boolean(result.rows[0]);
}

async function promoteFrozenManifests(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: PageIndexUpgradeBackfill,
  now: string,
): Promise<void> {
  await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [now, job.id, job.knowledgeSpaceId],
    sql: `UPDATE ${q(database, manifestTable)} SET ${q(
      database,
      "status",
    )} = 'ready', ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 3)} AND ${q(database, "status")} = 'building' AND ${q(
      database,
      "id",
    )} IN (SELECT manifest.${q(database, "id")} FROM ${q(
      database,
      itemTable,
    )} item JOIN ${q(database, manifestTable)} manifest ON manifest.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 3)} AND manifest.${q(
      database,
      "document_outline_id",
    )} = item.${q(database, "document_outline_id")} AND manifest.${q(
      database,
      "publication_generation_id",
    )} = item.${q(database, "publication_generation_id")} AND manifest.${q(
      database,
      "document_asset_id",
    )} = item.${q(database, "document_asset_id")} AND manifest.${q(
      database,
      "document_version",
    )} = item.${q(database, "document_version")} WHERE item.${q(
      database,
      "backfill_id",
    )} = ${p(database, 2)});`,
    tableName: manifestTable,
  });
}

async function loadCurrentHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  rawScope: PageIndexUpgradeBackfillLookupInput,
  lock: boolean,
): Promise<FrozenHead | null> {
  const scope = normalizeScope(rawScope);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT head.${q(database, "publication_id")} AS ${q(
      database,
      "publication_id",
    )}, head.${q(database, "head_revision")} AS ${q(
      database,
      "head_revision",
    )}, pub.${q(database, "fingerprint")} AS ${q(database, "fingerprint")} FROM ${q(
      database,
      headTable,
    )} head JOIN ${q(database, publicationTable)} pub ON pub.${q(
      database,
      "tenant_id",
    )} = head.${q(database, "tenant_id")} AND pub.${q(
      database,
      "knowledge_space_id",
    )} = head.${q(database, "knowledge_space_id")} AND pub.${q(
      database,
      "id",
    )} = head.${q(database, "publication_id")} AND pub.${q(
      database,
      "status",
    )} = 'published' WHERE head.${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND head.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: headTable,
  });
  const row = result.rows[0];
  return row
    ? {
        fingerprint: ProjectionSetFingerprintSchema.parse(stringColumn(row, "fingerprint")),
        headRevision: positiveNumber(numberColumn(row, "head_revision"), "headRevision"),
        knowledgeSpaceId: scope.knowledgeSpaceId,
        publicationId: UuidSchema.parse(stringColumn(row, "publication_id")),
        tenantId: scope.tenantId,
      }
    : null;
}

async function lockSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: PageIndexUpgradeBackfillLookupInput,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, scope))) {
    throw new PageIndexUpgradeBackfillTransitionError("Knowledge space was not found");
  }
}

async function requireFencedJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  fence: PageIndexUpgradeBackfillFence,
): Promise<PageIndexUpgradeBackfill> {
  const current = await getJobById(database, transaction, fence.jobId, true);
  if (
    !current ||
    current.runState !== "running" ||
    current.leaseToken !== fence.leaseToken ||
    current.rowVersion !== fence.expectedRowVersion ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= fence.now
  ) {
    throw new PageIndexUpgradeBackfillTransitionError(
      "PageIndex upgrade worker lost its lease or row-version fence",
    );
  }
  return current;
}

async function getJobById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  rawId: string,
  lock: boolean,
): Promise<PageIndexUpgradeBackfill | null> {
  const id = UuidSchema.parse(rawId);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function persistJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  previous: PageIndexUpgradeBackfill,
  next: PageIndexUpgradeBackfill,
): Promise<PageIndexUpgradeBackfill> {
  const columns = [
    "run_state",
    "completed_items",
    "worker_id",
    "lease_token",
    "lease_expires_at",
    "heartbeat_at",
    "retry_count",
    "row_version",
    "last_error_code",
    "last_error_message",
    "updated_at",
    "completed_at",
  ];
  const params: DatabaseQueryValue[] = [
    next.runState,
    next.completedItems,
    next.workerId ?? null,
    next.leaseToken ?? null,
    next.leaseExpiresAt ?? null,
    next.heartbeatAt ?? null,
    next.retryCount,
    next.rowVersion,
    next.lastErrorCode ?? null,
    next.lastErrorMessage ?? null,
    next.updatedAt,
    next.completedAt ?? null,
    previous.id,
    previous.rowVersion,
  ];
  const result = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, jobTable)} SET ${columns
      .map((column, index) => `${q(database, column)} = ${p(database, index + 1)}`)
      .join(", ")} WHERE ${q(database, "id")} = ${p(database, 13)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, 14)};`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new PageIndexUpgradeBackfillTransitionError(
      "PageIndex upgrade row changed before transition",
    );
  }
  return next;
}

async function insertJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: PageIndexUpgradeBackfill,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "publication_id",
    "publication_fingerprint",
    "head_revision",
    "run_state",
    "total_items",
    "completed_items",
    "retry_count",
    "row_version",
    "created_at",
    "updated_at",
  ];
  const params = [
    job.id,
    job.tenantId,
    job.knowledgeSpaceId,
    job.publicationId,
    job.publicationFingerprint,
    job.headRevision,
    job.runState,
    job.totalItems,
    job.completedItems,
    job.retryCount,
    job.rowVersion,
    job.createdAt,
    job.updatedAt,
  ] satisfies readonly DatabaseQueryValue[];
  const result = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, jobTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")});`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new PageIndexUpgradeBackfillTransitionError("PageIndex upgrade job was not inserted");
  }
}

async function insertItem(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  item: PageIndexUpgradeBackfillItem,
): Promise<void> {
  const params = [
    item.backfillId,
    item.documentOutlineId,
    item.publicationGenerationId,
    item.documentAssetId,
    item.documentVersion,
    item.ordinal,
    item.status,
    item.createdAt,
    item.updatedAt,
  ] satisfies readonly DatabaseQueryValue[];
  const result = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, itemTable)} (${[
      "backfill_id",
      "document_outline_id",
      "publication_generation_id",
      "document_asset_id",
      "document_version",
      "ordinal",
      "status",
      "created_at",
      "updated_at",
    ]
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")});`,
    tableName: itemTable,
  });
  if (result.rowsAffected !== 1) {
    throw new PageIndexUpgradeBackfillTransitionError("PageIndex upgrade item was not inserted");
  }
}

function outlineSelect(database: DatabaseAdapter): string {
  const outlineColumns = [
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
  return `SELECT item.*, ${outlineColumns
    .map((column) => `outline_row.${q(database, column)} AS ${q(database, `outline_${column}`)}`)
    .join(", ")}`;
}

function mapOutline(row: DatabaseRow): DocumentOutline {
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

function mapItem(row: DatabaseRow): PageIndexUpgradeBackfillItem {
  const status = stringColumn(row, "status");
  if (status !== "pending" && status !== "succeeded") {
    throw new Error(`Invalid PageIndex upgrade item status=${status}`);
  }
  return {
    backfillId: UuidSchema.parse(stringColumn(row, "backfill_id")),
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    documentAssetId: UuidSchema.parse(stringColumn(row, "document_asset_id")),
    documentOutlineId: UuidSchema.parse(stringColumn(row, "document_outline_id")),
    documentVersion: positiveNumber(numberColumn(row, "document_version"), "documentVersion"),
    ordinal: nonnegativeNumber(numberColumn(row, "ordinal"), "ordinal"),
    publicationGenerationId: PublicationGenerationIdSchema.parse(
      stringColumn(row, "publication_generation_id"),
    ),
    status,
    updatedAt: DateTimeSchema.parse(stringColumn(row, "updated_at")),
  };
}

function mapJob(row: DatabaseRow): PageIndexUpgradeBackfill {
  const runState = stringColumn(row, "run_state");
  if (!PageIndexUpgradeBackfillRunStates.includes(runState as PageIndexUpgradeBackfillRunState)) {
    throw new Error(`Invalid PageIndex upgrade runState=${runState}`);
  }
  const completedAt = optionalStringColumn(row, "completed_at");
  const heartbeatAt = optionalStringColumn(row, "heartbeat_at");
  const lastErrorCode = optionalStringColumn(row, "last_error_code");
  const lastErrorMessage = optionalStringColumn(row, "last_error_message");
  const leaseExpiresAt = optionalStringColumn(row, "lease_expires_at");
  const leaseToken = optionalStringColumn(row, "lease_token");
  const workerId = optionalStringColumn(row, "worker_id");
  return {
    ...(completedAt ? { completedAt: DateTimeSchema.parse(completedAt) } : {}),
    completedItems: nonnegativeNumber(numberColumn(row, "completed_items"), "completedItems"),
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    headRevision: positiveNumber(numberColumn(row, "head_revision"), "headRevision"),
    ...(heartbeatAt ? { heartbeatAt: DateTimeSchema.parse(heartbeatAt) } : {}),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    ...(lastErrorMessage ? { lastErrorMessage } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt: DateTimeSchema.parse(leaseExpiresAt) } : {}),
    ...(leaseToken ? { leaseToken: UuidSchema.parse(leaseToken) } : {}),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(
      stringColumn(row, "publication_fingerprint"),
    ),
    publicationId: UuidSchema.parse(stringColumn(row, "publication_id")),
    retryCount: nonnegativeNumber(numberColumn(row, "retry_count"), "retryCount"),
    rowVersion: nonnegativeNumber(numberColumn(row, "row_version"), "rowVersion"),
    runState: runState as PageIndexUpgradeBackfillRunState,
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    totalItems: nonnegativeNumber(numberColumn(row, "total_items"), "totalItems"),
    updatedAt: DateTimeSchema.parse(stringColumn(row, "updated_at")),
    ...(workerId ? { workerId } : {}),
  };
}

function withoutLease(job: PageIndexUpgradeBackfill): PageIndexUpgradeBackfill {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    workerId: _workerId,
    ...rest
  } = job;
  return rest;
}

function normalizeScope(
  input: PageIndexUpgradeBackfillLookupInput,
): PageIndexUpgradeBackfillLookupInput {
  return {
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeScopeWithNow(
  input: PageIndexUpgradeBackfillLookupInput & { readonly now: string },
) {
  return { ...normalizeScope(input), now: DateTimeSchema.parse(input.now) };
}

function normalizeFence(input: PageIndexUpgradeBackfillFence): PageIndexUpgradeBackfillFence {
  return {
    expectedRowVersion: nonnegativeNumber(input.expectedRowVersion, "expectedRowVersion"),
    jobId: UuidSchema.parse(input.jobId),
    leaseToken: PublicationGenerationIdSchema.parse(input.leaseToken),
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeHeartbeat(input: PageIndexUpgradeBackfillHeartbeatInput) {
  const fence = normalizeFence(input);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (leaseExpiresAt <= fence.now) {
    throw new Error("PageIndex upgrade leaseExpiresAt must be after now");
  }
  return {
    ...fence,
    leaseExpiresAt,
    workerId: requiredString(input.workerId, "workerId", 255),
  };
}

function normalizeClaim(input: ClaimPageIndexUpgradeBackfillsInput, maxClaimBatchSize: number) {
  const now = DateTimeSchema.parse(input.now);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (leaseExpiresAt <= now) {
    throw new Error("PageIndex upgrade leaseExpiresAt must be after now");
  }
  const limit = positiveNumber(input.limit, "limit");
  if (limit > maxClaimBatchSize) {
    throw new Error(`PageIndex upgrade claim limit exceeds maxClaimBatchSize=${maxClaimBatchSize}`);
  }
  return {
    leaseExpiresAt,
    limit,
    now,
    workerId: requiredString(input.workerId, "workerId", 255),
  };
}

function positiveInteger(value: number, name: string): void {
  positiveNumber(value, name);
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PageIndex upgrade ${name} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeNumber(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`PageIndex upgrade ${name} must be a non-negative safe integer`);
  }
  return value;
}

function requiredString(value: string, name: string, max = 255): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`PageIndex upgrade ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}
