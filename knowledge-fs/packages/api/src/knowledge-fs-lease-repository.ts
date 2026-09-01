import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeFsLease,
  KnowledgeFsLeaseSchema,
} from "@knowledge/core";

import { optionalNumberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForRetrievalAdmission } from "./knowledge-space-deletion-admission";

export interface KnowledgeFsLeaseLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

export interface KnowledgeFsLeaseHeartbeatInput extends KnowledgeFsLeaseLookupInput {
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeFsLeaseReleaseInput extends KnowledgeFsLeaseLookupInput {
  readonly status: "released" | "failed" | "expired";
  readonly updatedAt: string;
}

export interface KnowledgeFsLeaseListExpiredInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly now: string;
  readonly tenantId: string;
}

export interface KnowledgeFsLeaseListActiveInput extends KnowledgeFsLeaseListExpiredInput {
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeFsLeaseListResult {
  readonly items: readonly KnowledgeFsLease[];
  readonly nextCursor?: string | undefined;
}

export interface KnowledgeFsLeaseRepository {
  acquire(input: KnowledgeFsLease): Promise<KnowledgeFsLease>;
  delete(input: KnowledgeFsLeaseLookupInput): Promise<KnowledgeFsLease | null>;
  get(input: KnowledgeFsLeaseLookupInput): Promise<KnowledgeFsLease | null>;
  heartbeat(input: KnowledgeFsLeaseHeartbeatInput): Promise<KnowledgeFsLease | null>;
  listActive(input: KnowledgeFsLeaseListActiveInput): Promise<KnowledgeFsLeaseListResult>;
  listExpired(input: KnowledgeFsLeaseListExpiredInput): Promise<KnowledgeFsLeaseListResult>;
  release(input: KnowledgeFsLeaseReleaseInput): Promise<KnowledgeFsLease | null>;
}

export interface InMemoryKnowledgeFsLeaseRepositoryOptions {
  readonly maxLeases: number;
  readonly maxListLimit: number;
}

export interface DatabaseKnowledgeFsLeaseRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export class KnowledgeFsLeaseCapacityExceededError extends Error {
  constructor(maxLeases: number) {
    super(`KnowledgeFS lease repository maxLeases=${maxLeases} exceeded`);
  }
}

export class KnowledgeFsLeaseConflictError extends Error {
  constructor(lease: KnowledgeFsLease, conflictingLease: KnowledgeFsLease) {
    super(
      `KnowledgeFS lease conflict for ${lease.virtualPath}: ${lease.leaseType} conflicts with ${conflictingLease.leaseType}`,
    );
  }
}

export class KnowledgeFsLeaseListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`KnowledgeFS lease repository maxListLimit=${maxListLimit} exceeded`);
  }
}

export class KnowledgeFsLeaseDeletionFenceActiveError extends Error {
  constructor() {
    super("KnowledgeFS lease acquisition is unavailable while durable deletion is active");
  }
}

export function createInMemoryKnowledgeFsLeaseRepository({
  maxLeases,
  maxListLimit,
}: InMemoryKnowledgeFsLeaseRepositoryOptions): KnowledgeFsLeaseRepository {
  if (!Number.isSafeInteger(maxLeases) || maxLeases < 1) {
    throw new Error("KnowledgeFS lease repository maxLeases must be at least 1");
  }

  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS lease repository maxListLimit must be at least 1");
  }

  const leases = new Map<string, KnowledgeFsLease>();

  return {
    async acquire(input) {
      const lease = cloneLease(KnowledgeFsLeaseSchema.parse(input));
      const key = leaseKey(lease.tenantId, lease.id);

      if (!leases.has(key) && leases.size >= maxLeases) {
        throw new KnowledgeFsLeaseCapacityExceededError(maxLeases);
      }

      const conflict = findConflictingLease(leases, lease);

      if (conflict) {
        throw new KnowledgeFsLeaseConflictError(lease, conflict);
      }

      leases.set(key, cloneLease(lease));

      return cloneLease(lease);
    },

    async delete({ id, tenantId }) {
      const key = leaseKey(tenantId, id);
      const lease = leases.get(key);

      if (!lease) {
        return null;
      }

      leases.delete(key);

      return cloneLease(lease);
    },

    async get({ id, tenantId }) {
      const lease = leases.get(leaseKey(tenantId, id));

      return lease ? cloneLease(lease) : null;
    },

    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      const key = leaseKey(tenantId, id);
      const current = leases.get(key);

      if (!current) {
        return null;
      }

      const updated = cloneLease(
        KnowledgeFsLeaseSchema.parse({
          ...current,
          expiresAt,
          heartbeatAt,
          updatedAt,
        }),
      );
      leases.set(key, cloneLease(updated));

      return cloneLease(updated);
    },

    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredLeaseCursor(cursor) : null;
      const active = Array.from(leases.values())
        .filter((lease) => lease.tenantId === tenantId)
        .filter((lease) => lease.knowledgeSpaceId === knowledgeSpaceId)
        .filter((lease) => lease.status === "active")
        .filter((lease) => lease.expiresAt > now)
        .sort(compareExpiredLeases)
        .filter((lease) => (cursorTuple ? compareExpiredLeaseTuple(lease, cursorTuple) > 0 : true));
      const page = active.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneLease);
      const nextLease = page.at(limit);

      return {
        items,
        ...(nextLease === undefined ? {} : { nextCursor: encodeExpiredLeaseCursor(items.at(-1)) }),
      };
    },

    async listExpired({ cursor, limit, now, tenantId }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
      }

      const cursorTuple = cursor ? decodeExpiredLeaseCursor(cursor) : null;
      const expired = Array.from(leases.values())
        .filter((lease) => lease.tenantId === tenantId)
        .filter((lease) => lease.expiresAt <= now)
        .sort(compareExpiredLeases)
        .filter((lease) => (cursorTuple ? compareExpiredLeaseTuple(lease, cursorTuple) > 0 : true));
      const page = expired.slice(0, limit);
      const nextLease = expired.at(limit);

      return {
        items: page.map(cloneLease),
        ...(nextLease === undefined ? {} : { nextCursor: encodeExpiredLeaseCursor(page.at(-1)) }),
      };
    },

    async release({ id, status, tenantId, updatedAt }) {
      const key = leaseKey(tenantId, id);
      const current = leases.get(key);

      if (!current) {
        return null;
      }

      const updated = cloneLease(
        KnowledgeFsLeaseSchema.parse({
          ...current,
          status,
          updatedAt,
        }),
      );
      leases.set(key, cloneLease(updated));

      return cloneLease(updated);
    },
  };
}

export function createDatabaseKnowledgeFsLeaseRepository({
  database,
  maxListLimit,
}: DatabaseKnowledgeFsLeaseRepositoryOptions): KnowledgeFsLeaseRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeFS lease repository maxListLimit must be at least 1");
  }
  const tableName = "knowledge_fs_leases";
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);

  return {
    async acquire(input) {
      const lease = cloneLease(KnowledgeFsLeaseSchema.parse(input));
      return database.transaction(async (transaction) => {
        if (
          !(await lockKnowledgeSpaceForRetrievalAdmission(database, transaction, {
            knowledgeSpaceId: lease.knowledgeSpaceId,
            tenantId: lease.tenantId,
          }))
        ) {
          throw new KnowledgeFsLeaseDeletionFenceActiveError();
        }
        const targetDeletion = await selectKnowledgeFsLeaseTargetDeletion(
          database,
          transaction,
          lease,
        );
        if (targetDeletion) throw new KnowledgeFsLeaseDeletionFenceActiveError();
        if (lease.leaseType !== "read") {
          const conflict = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [
              lease.tenantId,
              lease.knowledgeSpaceId,
              lease.virtualPath,
              lease.id,
              lease.acquiredAt,
            ],
            sql: `SELECT * FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("virtual_path")} = ${p(3)} AND ${q("id")} <> ${p(4)} AND ${q("status")} = 'active' AND ${q("expires_at")} > ${p(5)} AND ${q("lease_type")} <> 'read' LIMIT 1 FOR UPDATE;`,
            tableName,
          });
          if (conflict.rows[0]) {
            throw new KnowledgeFsLeaseConflictError(
              lease,
              mapDatabaseKnowledgeFsLease(conflict.rows[0]),
            );
          }
        }
        const columns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "session_id",
          "lease_type",
          "target_type",
          "target_id",
          "target_version",
          "virtual_path",
          "status",
          "heartbeat_at",
          "expires_at",
          "metadata",
          "acquired_at",
          "updated_at",
        ] as const;
        const params = [
          lease.id,
          lease.tenantId,
          lease.knowledgeSpaceId,
          lease.sessionId,
          lease.leaseType,
          lease.targetType,
          lease.targetId,
          lease.targetVersion ?? null,
          lease.virtualPath,
          lease.status,
          lease.heartbeatAt,
          lease.expiresAt,
          JSON.stringify(lease.metadata),
          lease.acquiredAt,
          lease.updatedAt,
        ] satisfies readonly DatabaseQueryValue[];
        const candidateAlias = "lease_candidate";
        const candidateField = (column: string) => `${candidateAlias}.${q(column)}`;
        const result = await transaction.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(tableName)} (${columns.map(q).join(", ")}) SELECT ${columns.map(candidateField).join(", ")} FROM (SELECT ${columns.map((column, index) => `${jsonInsertPlaceholder(database, index + 1, column)} AS ${q(column)}`).join(", ")}) AS ${candidateAlias} INNER JOIN ${q("knowledge_spaces")} AS lease_space ON lease_space.${q("tenant_id")} = ${candidateField("tenant_id")} AND lease_space.${q("id")} = ${candidateField("knowledge_space_id")} INNER JOIN ${q("knowledge_fs_sessions")} AS lease_session ON lease_session.${q("tenant_id")} = ${candidateField("tenant_id")} AND lease_session.${q("knowledge_space_id")} = ${candidateField("knowledge_space_id")} AND lease_session.${q("id")} = ${candidateField("session_id")} AND lease_session.${q("expires_at")} > ${candidateField("acquired_at")} WHERE lease_space.${q("lifecycle_state")} = 'active' AND lease_space.${q("deletion_job_id")} IS NULL AND NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${candidateField("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${candidateField("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1 AND ${knowledgeFsLeaseDeletionOverlapSql(database, "active_deletion", candidateAlias)})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
        if (result.rowsAffected !== 1 && result.rows.length !== 1) {
          throw new KnowledgeFsLeaseDeletionFenceActiveError();
        }
        return result.rows[0] ? mapDatabaseKnowledgeFsLease(result.rows[0]) : lease;
      });
    },
    async delete({ id, tenantId }) {
      return database.transaction(async (transaction) => {
        const current = await databaseKnowledgeFsLeaseGet(database, transaction, {
          id,
          tenantId,
        });
        if (!current) return null;
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [tenantId, id],
          sql: `DELETE FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)};`,
          tableName,
        });
        return current;
      });
    },
    get: (input) => databaseKnowledgeFsLeaseGet(database, database, input),
    async heartbeat({ expiresAt, heartbeatAt, id, tenantId, updatedAt }) {
      return database.transaction(async (transaction) => {
        const scope = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [tenantId, id],
          sql: `SELECT ${q("knowledge_space_id")} FROM ${q(tableName)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} LIMIT 1;`,
          tableName,
        });
        const knowledgeSpaceId = scope.rows[0]?.knowledge_space_id;
        if (
          typeof knowledgeSpaceId !== "string" ||
          !(await lockKnowledgeSpaceForRetrievalAdmission(database, transaction, {
            knowledgeSpaceId,
            tenantId,
          }))
        ) {
          return null;
        }
        return updateDatabaseKnowledgeFsLease(database, {
          executor: transaction,
          fields: [
            ["expires_at", expiresAt],
            ["heartbeat_at", heartbeatAt],
            ["updated_at", updatedAt],
          ],
          fenced: true,
          id,
          tenantId,
        });
      });
    },
    async listActive({ cursor, knowledgeSpaceId, limit, now, tenantId }) {
      validateDatabaseLeaseListLimit(limit, maxListLimit);
      return databaseKnowledgeFsLeaseList(database, {
        active: true,
        cursor,
        knowledgeSpaceId,
        limit,
        now,
        tenantId,
      });
    },
    async listExpired({ cursor, limit, now, tenantId }) {
      validateDatabaseLeaseListLimit(limit, maxListLimit);
      return databaseKnowledgeFsLeaseList(database, {
        active: false,
        cursor,
        limit,
        now,
        tenantId,
      });
    },
    async release({ id, status, tenantId, updatedAt }) {
      return updateDatabaseKnowledgeFsLease(database, {
        fields: [
          ["status", status],
          ["updated_at", updatedAt],
        ],
        fenced: false,
        id,
        tenantId,
      });
    },
  };
}

async function databaseKnowledgeFsLeaseGet(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeFsLeaseLookupInput,
): Promise<KnowledgeFsLease | null> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.id],
    sql: `SELECT * FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("id")} = ${p(2)} AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")} LIMIT 1;`,
    tableName: "knowledge_fs_leases",
  });
  return result.rows[0] ? mapDatabaseKnowledgeFsLease(result.rows[0]) : null;
}

function knowledgeFsLeaseReadableSql(database: DatabaseAdapter, table: string): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  return `NOT EXISTS (SELECT 1 FROM ${q("deletion_jobs")} AS active_deletion WHERE active_deletion.${q("tenant_id")} = ${q(table)}.${q("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${q(table)}.${q("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1 AND ${knowledgeFsLeaseDeletionOverlapSql(database, "active_deletion", table)})`;
}

async function selectKnowledgeFsLeaseTargetDeletion(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  lease: KnowledgeFsLease,
): Promise<boolean> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const candidateAlias = "lease_candidate";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      lease.tenantId,
      lease.knowledgeSpaceId,
      lease.targetType,
      lease.targetId,
      lease.virtualPath,
      JSON.stringify(lease.metadata),
    ],
    sql: `SELECT active_deletion.${q("id")} FROM (SELECT ${p(1)} AS ${q("tenant_id")}, ${p(2)} AS ${q("knowledge_space_id")}, ${p(3)} AS ${q("target_type")}, ${p(4)} AS ${q("target_id")}, ${p(5)} AS ${q("virtual_path")}, ${jsonInsertPlaceholder(database, 6, "metadata")} AS ${q("metadata")}) AS ${candidateAlias} INNER JOIN ${q("deletion_jobs")} AS active_deletion ON active_deletion.${q("tenant_id")} = ${candidateAlias}.${q("tenant_id")} AND active_deletion.${q("knowledge_space_id")} = ${candidateAlias}.${q("knowledge_space_id")} AND active_deletion.${q("active_slot")} = 1 WHERE ${knowledgeFsLeaseDeletionOverlapSql(database, "active_deletion", candidateAlias)} LIMIT 1 FOR UPDATE;`,
    tableName: "deletion_jobs",
  });
  return result.rows.length > 0;
}

function knowledgeFsLeaseDeletionOverlapSql(
  database: DatabaseAdapter,
  deletionAlias: string,
  leaseAlias: string,
): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const deletion = (column: string) => `${deletionAlias}.${q(column)}`;
  const lease = (column: string) => `${leaseAlias}.${q(column)}`;
  const castId = (alias: string, column = "id") =>
    database.dialect === "postgres"
      ? `CAST(${alias}.${q(column)} AS TEXT)`
      : `CAST(${alias}.${q(column)} AS CHAR(36))`;
  const deletionTargetsDocument = (documentId: string) =>
    `((${deletion("target_type")} = 'document_asset' AND ${deletion("target_id")} = ${documentId}) OR (${deletion("target_type")} = 'source' AND EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_source_asset WHERE lease_source_asset.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_source_asset.${q("id")} = ${documentId} AND lease_source_asset.${q("source_id")} = ${deletion("target_id")})) OR (${deletion("target_type")} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} AS lease_document_revision WHERE lease_document_revision.${q("tenant_id")} = ${deletion("tenant_id")} AND lease_document_revision.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_document_revision.${q("document_asset_id")} = ${documentId} AND lease_document_revision.${q("document_id")} = ${deletion("target_id")})))`;
  const deletionTargetsSource = (sourceId: string) =>
    `((${deletion("target_type")} = 'source' AND ${deletion("target_id")} = ${sourceId}) OR (${deletion("target_type")} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q("logical_documents")} AS lease_source_document WHERE lease_source_document.${q("tenant_id")} = ${deletion("tenant_id")} AND lease_source_document.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_source_document.${q("id")} = ${deletion("target_id")} AND lease_source_document.${q("source_id")} = ${sourceId})) OR (${deletion("target_type")} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_source_asset WHERE lease_source_asset.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_source_asset.${q("id")} = ${deletion("target_id")} AND lease_source_asset.${q("source_id")} = ${sourceId})))`;
  const deletionTargetsLogicalDocument = (documentId: string) =>
    `((${deletion("target_type")} = 'logical_document' AND ${deletion("target_id")} = ${documentId}) OR (${deletion("target_type")} = 'source' AND EXISTS (SELECT 1 FROM ${q("logical_documents")} AS lease_path_document WHERE lease_path_document.${q("tenant_id")} = ${deletion("tenant_id")} AND lease_path_document.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_path_document.${q("id")} = ${documentId} AND lease_path_document.${q("source_id")} = ${deletion("target_id")})) OR (${deletion("target_type")} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q("document_revisions")} AS lease_path_revision WHERE lease_path_revision.${q("tenant_id")} = ${deletion("tenant_id")} AND lease_path_revision.${q("knowledge_space_id")} = ${deletion("knowledge_space_id")} AND lease_path_revision.${q("document_id")} = ${documentId} AND lease_path_revision.${q("document_asset_id")} = ${deletion("target_id")})))`;
  const directDocument = `EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_document WHERE lease_document.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${castId("lease_document")} = ${lease("target_id")} AND ${deletionTargetsDocument(`lease_document.${q("id")}`)})`;
  const virtualDocument = `EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_virtual_document WHERE lease_virtual_document.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${lease("virtual_path")} = CONCAT('/sources/documents/', ${castId("lease_virtual_document")}) AND ${deletionTargetsDocument(`lease_virtual_document.${q("id")}`)})`;
  const metadataDocumentId =
    database.dialect === "postgres"
      ? `${lease("metadata")} ->> 'documentAssetId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(${lease("metadata")}, '$.documentAssetId'))`;
  const metadataDocument = `EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_metadata_document WHERE lease_metadata_document.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${castId("lease_metadata_document")} = ${metadataDocumentId} AND ${deletionTargetsDocument(`lease_metadata_document.${q("id")}`)})`;
  const parseArtifact = `(${lease("target_type")} = 'parse-artifact' AND EXISTS (SELECT 1 FROM ${q("parse_artifacts")} AS lease_artifact WHERE ${castId("lease_artifact")} = ${lease("target_id")} AND ${deletionTargetsDocument(`lease_artifact.${q("document_asset_id")}`)}))`;
  const projection = `(${lease("target_type")} = 'projection' AND EXISTS (SELECT 1 FROM ${q("index_projections")} AS lease_projection INNER JOIN ${q("knowledge_nodes")} AS lease_projection_node ON lease_projection_node.${q("id")} = lease_projection.${q("node_id")} WHERE ${castId("lease_projection")} = ${lease("target_id")} AND lease_projection_node.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${deletionTargetsDocument(`lease_projection_node.${q("document_asset_id")}`)}))`;
  const stagedCommit = `(${lease("target_type")} = 'staged-commit' AND EXISTS (SELECT 1 FROM ${q("knowledge_space_staged_commits")} AS lease_commit WHERE lease_commit.${q("tenant_id")} = ${lease("tenant_id")} AND lease_commit.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND (${castId("lease_commit")} = ${lease("target_id")} OR lease_commit.${q("raw_object_key")} = ${lease("target_id")} OR lease_commit.${q("published_object_key")} = ${lease("target_id")}) AND ${deletionTargetsDocument(`lease_commit.${q("document_asset_id")}`)}))`;
  const path = `(${lease("target_type")} = 'knowledge-path' AND EXISTS (SELECT 1 FROM ${q("knowledge_paths")} AS lease_path WHERE lease_path.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND (${castId("lease_path")} = ${lease("target_id")} OR lease_path.${q("target_id")} = ${lease("target_id")} OR lease_path.${q("virtual_path")} = ${lease("virtual_path")}) AND ((lease_path.${q("resource_type")} = 'source' AND EXISTS (SELECT 1 FROM ${q("sources")} AS lease_path_source WHERE lease_path_source.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${castId("lease_path_source")} = lease_path.${q("target_id")} AND ${deletionTargetsSource(`lease_path_source.${q("id")}`)})) OR (lease_path.${q("resource_type")} = 'document' AND (EXISTS (SELECT 1 FROM ${q("logical_documents")} AS lease_path_document WHERE lease_path_document.${q("tenant_id")} = ${deletion("tenant_id")} AND lease_path_document.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${castId("lease_path_document")} = lease_path.${q("target_id")} AND ${deletionTargetsLogicalDocument(`lease_path_document.${q("id")}`)}) OR EXISTS (SELECT 1 FROM ${q("document_assets")} AS lease_path_asset WHERE lease_path_asset.${q("knowledge_space_id")} = ${lease("knowledge_space_id")} AND ${castId("lease_path_asset")} = lease_path.${q("target_id")} AND ${deletionTargetsDocument(`lease_path_asset.${q("id")}`)}))))))`;
  return `((${deletion("target_type")} = 'knowledge_space' AND ${deletion("target_id")} = ${lease("knowledge_space_id")}) OR ${lease("target_type")} = 'knowledge-space' OR (${lease("target_type")} = 'document-asset' AND ${directDocument}) OR ${virtualDocument} OR ${metadataDocument} OR ${parseArtifact} OR ${projection} OR ${stagedCommit} OR ${path})`;
}

async function updateDatabaseKnowledgeFsLease(
  database: DatabaseAdapter,
  input: {
    readonly executor?: DatabaseExecutor | undefined;
    readonly fields: readonly (readonly [string, DatabaseQueryValue])[];
    readonly fenced: boolean;
    readonly id: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeFsLease | null> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const params: DatabaseQueryValue[] = input.fields.map((field) => field[1]);
  params.push(input.tenantId, input.id);
  const tenantPosition = input.fields.length + 1;
  const idPosition = input.fields.length + 2;
  const executor = input.executor ?? database;
  const result = await executor.execute({
    maxRows: 1,
    operation: "update",
    params,
    sql: `UPDATE ${q("knowledge_fs_leases")} SET ${input.fields
      .map(([column], index) => `${q(column)} = ${p(index + 1)}`)
      .join(
        ", ",
      )} WHERE ${q("tenant_id")} = ${p(tenantPosition)} AND ${q("id")} = ${p(idPosition)}${input.fenced ? ` AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")}` : ""}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
    tableName: "knowledge_fs_leases",
  });
  if (result.rows[0]) return mapDatabaseKnowledgeFsLease(result.rows[0]);
  return result.rowsAffected > 0
    ? databaseKnowledgeFsLeaseGet(database, executor, {
        id: input.id,
        tenantId: input.tenantId,
      })
    : null;
}

async function databaseKnowledgeFsLeaseList(
  database: DatabaseAdapter,
  input: {
    readonly active: boolean;
    readonly cursor?: string | undefined;
    readonly knowledgeSpaceId?: string | undefined;
    readonly limit: number;
    readonly now: string;
    readonly tenantId: string;
  },
): Promise<KnowledgeFsLeaseListResult> {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  const cursor = input.cursor ? decodeExpiredLeaseCursor(input.cursor) : undefined;
  const params: DatabaseQueryValue[] = [input.tenantId];
  let scope = "";
  if (input.knowledgeSpaceId) {
    params.push(input.knowledgeSpaceId);
    scope = ` AND ${q("knowledge_space_id")} = ${p(params.length)}`;
  }
  params.push(input.now);
  const nowPosition = params.length;
  let cursorSql = "";
  if (cursor) {
    params.push(cursor.expiresAt, cursor.expiresAt, cursor.id);
    cursorSql = ` AND (${q("expires_at")} > ${p(params.length - 2)} OR (${q("expires_at")} = ${p(params.length - 1)} AND ${q("id")} > ${p(params.length)}))`;
  }
  params.push(input.limit + 1);
  const result = await database.execute({
    maxRows: input.limit + 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q("knowledge_fs_leases")} WHERE ${q("tenant_id")} = ${p(1)}${scope} AND ${input.active ? `${q("status")} = 'active' AND ${q("expires_at")} >` : `${q("expires_at")} <=`} ${p(nowPosition)}${cursorSql} AND ${knowledgeFsLeaseReadableSql(database, "knowledge_fs_leases")} ORDER BY ${q("expires_at")} ASC, ${q("id")} ASC LIMIT ${p(params.length)};`,
    tableName: "knowledge_fs_leases",
  });
  const page = result.rows.map(mapDatabaseKnowledgeFsLease);
  const items = page.slice(0, input.limit);
  return {
    items,
    ...(page.length > input.limit ? { nextCursor: encodeExpiredLeaseCursor(items.at(-1)) } : {}),
  };
}

function mapDatabaseKnowledgeFsLease(row: DatabaseRow): KnowledgeFsLease {
  const targetVersion = optionalNumberColumn(row, "target_version");
  return KnowledgeFsLeaseSchema.parse({
    acquiredAt: stringColumn(row, "acquired_at"),
    expiresAt: stringColumn(row, "expires_at"),
    heartbeatAt: stringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    leaseType: stringColumn(row, "lease_type"),
    metadata: jsonObjectColumn(row, "metadata"),
    sessionId: stringColumn(row, "session_id"),
    status: stringColumn(row, "status"),
    targetId: stringColumn(row, "target_id"),
    targetType: stringColumn(row, "target_type"),
    ...(targetVersion === undefined ? {} : { targetVersion }),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    virtualPath: stringColumn(row, "virtual_path"),
  });
}

function validateDatabaseLeaseListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new KnowledgeFsLeaseListLimitExceededError(maxListLimit);
  }
}

function findConflictingLease(
  leases: ReadonlyMap<string, KnowledgeFsLease>,
  requested: KnowledgeFsLease,
): KnowledgeFsLease | null {
  if (requested.leaseType === "read") {
    return null;
  }

  for (const existing of leases.values()) {
    if (
      existing.id === requested.id ||
      existing.tenantId !== requested.tenantId ||
      existing.knowledgeSpaceId !== requested.knowledgeSpaceId ||
      existing.virtualPath !== requested.virtualPath ||
      existing.status !== "active" ||
      existing.expiresAt <= requested.acquiredAt ||
      existing.leaseType === "read"
    ) {
      continue;
    }

    return cloneLease(existing);
  }

  return null;
}

function compareExpiredLeases(left: KnowledgeFsLease, right: KnowledgeFsLease): number {
  return left.expiresAt.localeCompare(right.expiresAt) || left.id.localeCompare(right.id);
}

function compareExpiredLeaseTuple(
  lease: KnowledgeFsLease,
  cursor: { readonly expiresAt: string; readonly id: string },
): number {
  return lease.expiresAt.localeCompare(cursor.expiresAt) || lease.id.localeCompare(cursor.id);
}

function encodeExpiredLeaseCursor(lease: KnowledgeFsLease | undefined): string | undefined {
  if (!lease) {
    return undefined;
  }

  return Buffer.from(JSON.stringify({ expiresAt: lease.expiresAt, id: lease.id })).toString(
    "base64url",
  );
}

function decodeExpiredLeaseCursor(cursor: string): {
  readonly expiresAt: string;
  readonly id: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      expiresAt?: unknown;
      id?: unknown;
    };

    if (typeof decoded.expiresAt === "string" && typeof decoded.id === "string") {
      return { expiresAt: decoded.expiresAt, id: decoded.id };
    }
  } catch {
    // Fall through to a stable validation error below.
  }

  throw new Error("KnowledgeFS lease cursor is invalid");
}

function leaseKey(tenantId: string, id: string): string {
  return `${tenantId}:${id}`;
}

function cloneLease(lease: KnowledgeFsLease): KnowledgeFsLease {
  return KnowledgeFsLeaseSchema.parse(JSON.parse(JSON.stringify(lease)) as unknown);
}
