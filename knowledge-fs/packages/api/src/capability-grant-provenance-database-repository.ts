import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import {
  type AdmitCapabilityGrantInput,
  type ApplyCapabilityGrantRevokeInput,
  type ApplyCapabilitySpaceFenceInput,
  type CapabilityAuthorizationRevision,
  CapabilityGrantConflictError,
  type CapabilityGrantProvenance,
  type CapabilityGrantProvenanceRepository,
  type CapabilityGrantRevokeResult,
  type CapabilityGrantScope,
  CapabilityPublicationFencedError,
  CapabilityRevokeEventConflictError,
  type CapabilitySpaceFenceResult,
  capabilityGrantClaimsDigest,
  normalizeCapabilityGrantAdmission,
  validateCapabilityGrantRevoke,
  validateCapabilityGrantScope,
  validateCapabilitySpaceFence,
} from "./capability-grant-provenance";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";

const grantTable = "capability_grants";
const fenceTable = "capability_space_fences";
const receiptTable = "capability_revoke_receipts";

export interface CreateDatabaseCapabilityGrantProvenanceRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly now?: (() => string) | undefined;
}

interface StoredGrant {
  readonly claimsDigest: string;
  readonly provenance: CapabilityGrantProvenance;
}

interface StoredFence {
  readonly highestRevokeSequence: number;
  readonly tombstoned: boolean;
}

interface StoredReceipt {
  readonly grantId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly reasonCode: string;
  readonly revokeSequence: number;
  readonly targetKind: "grant" | "space";
  readonly tenantId: string;
  readonly tombstoned?: boolean | undefined;
}

/**
 * Stores only a normalized claims summary and monotonic revocation state. Every read and mutation
 * is scoped by tenant plus knowledge space; the original Capability and raw jti never cross this
 * persistence boundary.
 */
export function createDatabaseCapabilityGrantProvenanceRepository({
  database,
  now = () => new Date().toISOString(),
}: CreateDatabaseCapabilityGrantProvenanceRepositoryOptions): CapabilityGrantProvenanceRepository {
  return {
    admit: async (input) =>
      database.transaction(async (transaction) => {
        const normalized = normalizeCapabilityGrantAdmission(input);
        const digest = capabilityGrantClaimsDigest(normalized);
        const existing = await findGrant(database, transaction, normalized, true);
        if (existing) {
          if (existing.claimsDigest !== digest) throw new CapabilityGrantConflictError();
          return existing.provenance;
        }

        const timestamp = now();
        const provenance: CapabilityGrantProvenance = {
          ...normalized,
          admittedAt: timestamp,
          highestRevokeSequence: 0,
          revision: 1,
          state: "active",
          updatedAt: timestamp,
        };
        await insertGrant(database, transaction, provenance, digest);
        return provenance;
      }),
    applyGrantRevoke: async (input) =>
      database.transaction(async (transaction) => {
        validateCapabilityGrantRevoke(input);
        const receipt = await findReceipt(database, transaction, input.eventId);
        if (receipt) assertReceiptReplay(receipt, input, "grant");
        const duplicate = receipt !== null;
        const stored = await findGrant(database, transaction, input, true);
        if (!stored) throw new CapabilityPublicationFencedError();
        if (duplicate || input.revokeSequence <= stored.provenance.highestRevokeSequence) {
          if (!duplicate) {
            await insertReceipt(database, transaction, input, "grant", false, now());
          }
          return grantResult(stored.provenance, false);
        }

        const timestamp = now();
        const next: CapabilityGrantProvenance = {
          ...stored.provenance,
          highestRevokeSequence: input.revokeSequence,
          revision: stored.provenance.revision + 1,
          revokeReasonCode: input.reasonCode,
          revokedAt: timestamp,
          state: "revoked",
          updatedAt: timestamp,
        };
        await updateGrantRevoke(database, transaction, next, stored.provenance.revision);
        await insertReceipt(database, transaction, input, "grant", true, timestamp);
        return grantResult(next, true);
      }),
    applySpaceFence: async (input) =>
      database.transaction(async (transaction) => {
        validateCapabilitySpaceFence(input);
        const receipt = await findReceipt(database, transaction, input.eventId);
        if (receipt) assertReceiptReplay(receipt, input, "space");
        const duplicate = receipt !== null;
        const stored = await findSpaceFence(database, transaction, input, true);
        if (duplicate) {
          if (!stored) throw new Error("Capability revoke receipt has no matching space fence");
          return fenceResult(stored, false);
        }
        if (stored && input.revokeSequence <= stored.highestRevokeSequence) {
          await insertReceipt(database, transaction, input, "space", false, now());
          return fenceResult(stored, false);
        }

        const next: StoredFence = {
          highestRevokeSequence: input.revokeSequence,
          tombstoned: input.tombstoned,
        };
        const timestamp = now();
        if (stored) {
          await updateSpaceFence(database, transaction, input, timestamp);
        } else {
          await insertSpaceFence(database, transaction, input, timestamp);
        }
        await insertReceipt(database, transaction, input, "space", true, timestamp);
        return fenceResult(next, true);
      }),
    assertPublicationAllowed: async (scope) => {
      validateCapabilityGrantScope(scope);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [scope.tenantId, scope.knowledgeSpaceId, scope.grantId],
        sql: `SELECT grant_row.${q(database, "grant_id")} FROM ${q(
          database,
          grantTable,
        )} grant_row LEFT JOIN ${q(database, fenceTable)} space_fence ON space_fence.${q(
          database,
          "tenant_id",
        )} = grant_row.${q(database, "tenant_id")} AND space_fence.${q(
          database,
          "knowledge_space_id",
        )} = grant_row.${q(database, "knowledge_space_id")} WHERE grant_row.${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND grant_row.${q(database, "knowledge_space_id")} = ${p(
          database,
          2,
        )} AND grant_row.${q(database, "grant_id")} = ${p(
          database,
          3,
        )} AND grant_row.${q(database, "state")} = 'active' AND (space_fence.${q(
          database,
          "tombstoned",
        )} IS NULL OR space_fence.${q(database, "tombstoned")} = FALSE) LIMIT 1`,
        tableName: grantTable,
      });
      if (result.rows.length !== 1) throw new CapabilityPublicationFencedError();
    },
    get: async (scope) => {
      validateCapabilityGrantScope(scope);
      return (await findGrant(database, database, scope, false))?.provenance ?? null;
    },
  };
}

async function findGrant(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: CapabilityGrantScope,
  lock: boolean,
): Promise<StoredGrant | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.grantId],
    sql: `SELECT * FROM ${q(database, grantTable)} WHERE ${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(
      database,
      "grant_id",
    )} = ${p(database, 3)}${lock ? " FOR UPDATE" : ""}`,
    tableName: grantTable,
  });
  return result.rows[0] ? storedGrantFromRow(result.rows[0]) : null;
}

async function insertGrant(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  grant: CapabilityGrantProvenance,
  digest: string,
): Promise<void> {
  const columns = [
    "tenant_id",
    "knowledge_space_id",
    "grant_id",
    "claims_digest",
    "subject_id",
    "actor_id",
    "caller_kind",
    "action",
    "resource_type",
    "resource_id",
    "resource_parent_id",
    "jti_hash",
    "trace_id",
    "authz_revision",
    "content_scope_ids",
    "content_policy_revision",
    "issued_at",
    "expires_at",
    "state",
    "highest_revoke_sequence",
    "revoke_reason_code",
    "revoked_at",
    "revision",
    "admitted_at",
    "updated_at",
  ] as const;
  const params: DatabaseQueryValue[] = [
    grant.tenantId,
    grant.knowledgeSpaceId,
    grant.grantId,
    digest,
    grant.subjectId,
    grant.actorId,
    grant.callerKind,
    grant.action,
    grant.resource.type,
    grant.resource.id,
    grant.resource.parentId ?? null,
    grant.jtiHash,
    grant.traceId,
    JSON.stringify(grant.authzRevision),
    JSON.stringify(grant.contentScopeIds),
    grant.contentPolicyRevision,
    grant.issuedAt,
    grant.expiresAt,
    grant.state,
    grant.highestRevokeSequence,
    null,
    null,
    grant.revision,
    grant.admittedAt,
    grant.updatedAt,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, grantTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) =>
        column === "authz_revision" || column === "content_scope_ids"
          ? jsonPlaceholder(database, index + 1)
          : p(database, index + 1),
      )
      .join(", ")})`,
    tableName: grantTable,
  });
}

async function updateGrantRevoke(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  grant: CapabilityGrantProvenance,
  expectedRevision: number,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      grant.state,
      grant.highestRevokeSequence,
      grant.revokeReasonCode ?? null,
      grant.revokedAt ?? null,
      grant.revision,
      grant.updatedAt,
      grant.tenantId,
      grant.knowledgeSpaceId,
      grant.grantId,
      expectedRevision,
    ],
    sql: `UPDATE ${q(database, grantTable)} SET ${q(database, "state")} = ${p(
      database,
      1,
    )}, ${q(database, "highest_revoke_sequence")} = ${p(database, 2)}, ${q(
      database,
      "revoke_reason_code",
    )} = ${p(database, 3)}, ${q(database, "revoked_at")} = ${p(database, 4)}, ${q(
      database,
      "revision",
    )} = ${p(database, 5)}, ${q(database, "updated_at")} = ${p(
      database,
      6,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 7)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 8)} AND ${q(database, "grant_id")} = ${p(
      database,
      9,
    )} AND ${q(database, "revision")} = ${p(database, 10)}`,
    tableName: grantTable,
  });
  if (result.rowsAffected !== 1) throw new Error("Capability grant revoke lost its CAS race");
}

async function findReceipt(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  eventId: string,
): Promise<StoredReceipt | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [eventId],
    sql: `SELECT * FROM ${q(database, receiptTable)} WHERE ${q(
      database,
      "event_id",
    )} = ${p(database, 1)} FOR UPDATE`,
    tableName: receiptTable,
  });
  const row = result.rows[0];
  if (!row) return null;
  const targetKind = stringColumn(row, "target_kind");
  if (targetKind !== "grant" && targetKind !== "space") {
    throw new Error("Capability revoke receipt target kind is invalid");
  }
  const grantId = optionalStringColumn(row, "grant_id");
  const tombstoned = optionalBooleanColumn(row, "tombstoned");
  return {
    ...(grantId ? { grantId } : {}),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    reasonCode: stringColumn(row, "reason_code"),
    revokeSequence: numberColumn(row, "revoke_sequence"),
    targetKind,
    tenantId: stringColumn(row, "tenant_id"),
    ...(tombstoned === undefined ? {} : { tombstoned }),
  };
}

async function insertReceipt(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ApplyCapabilityGrantRevokeInput | ApplyCapabilitySpaceFenceInput,
  targetKind: "grant" | "space",
  applied: boolean,
  receivedAt: string,
): Promise<void> {
  const params: DatabaseQueryValue[] = [
    input.eventId,
    input.tenantId,
    input.knowledgeSpaceId,
    targetKind,
    "grantId" in input ? input.grantId : null,
    input.revokeSequence,
    input.reasonCode,
    "tombstoned" in input ? input.tombstoned : null,
    applied,
    receivedAt,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, receiptTable)} (${[
      "event_id",
      "tenant_id",
      "knowledge_space_id",
      "target_kind",
      "grant_id",
      "revoke_sequence",
      "reason_code",
      "tombstoned",
      "applied",
      "received_at",
    ]
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")})`,
    tableName: receiptTable,
  });
}

async function findSpaceFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: Pick<CapabilityGrantScope, "knowledgeSpaceId" | "tenantId">,
  lock: boolean,
): Promise<StoredFence | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT * FROM ${q(database, fenceTable)} WHERE ${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${lock ? " FOR UPDATE" : ""}`,
    tableName: fenceTable,
  });
  return result.rows[0]
    ? {
        highestRevokeSequence: numberColumn(result.rows[0], "highest_revoke_sequence"),
        tombstoned: booleanColumn(result.rows[0], "tombstoned"),
      }
    : null;
}

async function insertSpaceFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ApplyCapabilitySpaceFenceInput,
  timestamp: string,
): Promise<void> {
  const params: DatabaseQueryValue[] = [
    input.tenantId,
    input.knowledgeSpaceId,
    input.tombstoned,
    input.revokeSequence,
    input.reasonCode,
    1,
    timestamp,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, fenceTable)} (${[
      "tenant_id",
      "knowledge_space_id",
      "tombstoned",
      "highest_revoke_sequence",
      "reason_code",
      "revision",
      "updated_at",
    ]
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")})`,
    tableName: fenceTable,
  });
}

async function updateSpaceFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ApplyCapabilitySpaceFenceInput,
  timestamp: string,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      input.tombstoned,
      input.revokeSequence,
      input.reasonCode,
      timestamp,
      input.tenantId,
      input.knowledgeSpaceId,
      input.revokeSequence,
    ],
    sql: `UPDATE ${q(database, fenceTable)} SET ${q(database, "tombstoned")} = ${p(
      database,
      1,
    )}, ${q(database, "highest_revoke_sequence")} = ${p(database, 2)}, ${q(
      database,
      "reason_code",
    )} = ${p(database, 3)}, ${q(database, "revision")} = ${q(
      database,
      "revision",
    )} + 1, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      6,
    )} AND ${q(database, "highest_revoke_sequence")} < ${p(database, 7)}`,
    tableName: fenceTable,
  });
  if (result.rowsAffected !== 1) throw new Error("Capability space fence lost its CAS race");
}

function storedGrantFromRow(row: DatabaseRow): StoredGrant {
  const authzRevision = authorizationRevisionFromRow(row);
  const resourceParentId = optionalStringColumn(row, "resource_parent_id");
  const revokeReasonCode = optionalStringColumn(row, "revoke_reason_code");
  const revokedAt = optionalStringColumn(row, "revoked_at");
  const state = stringColumn(row, "state");
  if (state !== "active" && state !== "revoked") {
    throw new Error("Capability grant database state is invalid");
  }
  return {
    claimsDigest: stringColumn(row, "claims_digest"),
    provenance: {
      action: stringColumn(row, "action"),
      actorId: stringColumn(row, "actor_id"),
      admittedAt: stringColumn(row, "admitted_at"),
      authzRevision,
      callerKind: callerKindFromRow(row),
      contentPolicyRevision: numberColumn(row, "content_policy_revision"),
      contentScopeIds: jsonStringArrayColumn(row, "content_scope_ids"),
      expiresAt: stringColumn(row, "expires_at"),
      grantId: stringColumn(row, "grant_id"),
      highestRevokeSequence: numberColumn(row, "highest_revoke_sequence"),
      issuedAt: stringColumn(row, "issued_at"),
      jtiHash: stringColumn(row, "jti_hash"),
      knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
      resource: {
        id: stringColumn(row, "resource_id"),
        ...(resourceParentId ? { parentId: resourceParentId } : {}),
        type: stringColumn(row, "resource_type"),
      },
      revision: numberColumn(row, "revision"),
      ...(revokeReasonCode ? { revokeReasonCode } : {}),
      ...(revokedAt ? { revokedAt } : {}),
      state,
      subjectId: stringColumn(row, "subject_id"),
      tenantId: stringColumn(row, "tenant_id"),
      traceId: stringColumn(row, "trace_id"),
      updatedAt: stringColumn(row, "updated_at"),
    },
  };
}

function authorizationRevisionFromRow(row: DatabaseRow): CapabilityAuthorizationRevision {
  const value = jsonObjectColumn(row, "authz_revision");
  const credentialRevision = value.credentialRevision;
  const externalAccessEpoch = value.externalAccessEpoch;
  const membershipEpoch = value.membershipEpoch;
  const spaceAclEpoch = value.spaceAclEpoch;
  if (
    (credentialRevision !== null && typeof credentialRevision !== "number") ||
    typeof externalAccessEpoch !== "number" ||
    typeof membershipEpoch !== "number" ||
    typeof spaceAclEpoch !== "number"
  ) {
    throw new Error("Capability grant authz revision database value is invalid");
  }
  return { credentialRevision, externalAccessEpoch, membershipEpoch, spaceAclEpoch };
}

function callerKindFromRow(row: DatabaseRow): CapabilityGrantProvenance["callerKind"] {
  const value = stringColumn(row, "caller_kind");
  if (
    value !== "agent" &&
    value !== "interactive" &&
    value !== "internal_worker" &&
    value !== "mcp" &&
    value !== "service" &&
    value !== "workflow"
  ) {
    throw new Error("Capability grant caller kind database value is invalid");
  }
  return value;
}

function booleanColumn(row: DatabaseRow, column: string): boolean {
  const value = row[column];
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`Database row column ${column} must be a boolean`);
}

function optionalBooleanColumn(row: DatabaseRow, column: string): boolean | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  return booleanColumn(row, column);
}

function grantResult(
  grant: CapabilityGrantProvenance,
  applied: boolean,
): CapabilityGrantRevokeResult {
  return {
    applied,
    highestRevokeSequence: grant.highestRevokeSequence,
    state: grant.state,
  };
}

function fenceResult(fence: StoredFence, applied: boolean): CapabilitySpaceFenceResult {
  return {
    applied,
    highestRevokeSequence: fence.highestRevokeSequence,
    tombstoned: fence.tombstoned,
  };
}

function assertReceiptReplay(
  receipt: StoredReceipt,
  input: ApplyCapabilityGrantRevokeInput | ApplyCapabilitySpaceFenceInput,
  targetKind: "grant" | "space",
): void {
  const expectedGrantId = "grantId" in input ? input.grantId : undefined;
  const expectedTombstoned = "tombstoned" in input ? input.tombstoned : undefined;
  if (
    receipt.targetKind !== targetKind ||
    receipt.tenantId !== input.tenantId ||
    receipt.knowledgeSpaceId !== input.knowledgeSpaceId ||
    receipt.grantId !== expectedGrantId ||
    receipt.revokeSequence !== input.revokeSequence ||
    receipt.reasonCode !== input.reasonCode ||
    receipt.tombstoned !== expectedTombstoned
  ) {
    throw new CapabilityRevokeEventConflictError();
  }
}

function jsonPlaceholder(database: DatabaseAdapter, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
