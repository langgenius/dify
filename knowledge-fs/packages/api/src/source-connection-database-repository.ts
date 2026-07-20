import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import { assertDatabaseKnowledgeSpacePermissionFence } from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import {
  type SourceConnection,
  SourceConnectionError,
  type SourceConnectionPermissionFence,
  type SourceConnectionRepository,
  type SourceConnectionSecretRef,
  type SourceOAuthTransaction,
  decodeConnectionCursor,
  encodeConnectionCursor,
} from "./source-connection";

const connectionTable = "source_connections";
const oauthTable = "source_oauth_transactions";
const secretRefTable = "source_connection_secret_refs";

export function createDatabaseSourceConnectionRepository(input: {
  readonly database: DatabaseAdapter;
  readonly maxListLimit?: number | undefined;
}): SourceConnectionRepository {
  const maxListLimit = input.maxListLimit ?? 200;
  const { database } = input;

  return {
    begin: async ({ permissionFence, ...record }) => {
      const connection: SourceConnection = {
        ...record,
        status: "provisioning",
        updatedAt: record.createdAt,
        version: 1,
      };
      const columns = [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "provider_id",
        "name",
        "auth_kind",
        "status",
        "configuration",
        "credential_ref",
        "scopes",
        "version",
        "created_at",
        "updated_at",
      ] as const;
      const params: DatabaseQueryValue[] = [
        connection.id,
        connection.tenantId,
        connection.knowledgeSpaceId,
        connection.providerId,
        connection.name,
        connection.authKind,
        connection.status,
        JSON.stringify(connection.configuration),
        connection.credentialRef ?? null,
        JSON.stringify(connection.scopes),
        connection.version,
        connection.createdAt,
        connection.updatedAt,
      ];
      await database.transaction(async (tx) => {
        await requireSpaceAdmission(database, tx, connection);
        await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: tx,
          fence: permissionFence,
          now: connection.createdAt,
          requiredAccess: "write",
        });
        await tx.execute({
          maxRows: 0,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(database, connectionTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${columns
            .map((column, index) =>
              column === "configuration" || column === "scopes"
                ? jsonValue(database, index + 1)
                : p(database, index + 1),
            )
            .join(", ")});`,
          tableName: connectionTable,
        });
        if (connection.credentialRef) {
          await insertSecretRef(
            database,
            tx,
            {
              connectionId: connection.id,
              credentialRef: connection.credentialRef,
              id: randomUUID(),
              knowledgeSpaceId: connection.knowledgeSpaceId,
              providerId: connection.providerId,
              purpose: "connection-credential",
              recoverAfter: new Date(Date.parse(connection.createdAt) + 5 * 60_000).toISOString(),
              remoteRevokeRequired: false,
              rowVersion: 1,
              state: "staged",
              tenantId: connection.tenantId,
            },
            connection.createdAt,
          );
        }
      });
      return connection;
    },
    activate: (request) =>
      updateConnection(database, request.connectionId, request.expectedVersion, {
        expiresAt: request.expiresAt ?? null,
        lastErrorCode: null,
        now: request.now,
        permissionFence: request.permissionFence,
        scopes: request.scopes,
        status: "active",
      }),
    fail: (request) =>
      updateConnection(database, request.connectionId, request.expectedVersion, {
        lastErrorCode: request.errorCode,
        now: request.now,
        status: "error",
      }),
    revoke: async (request) => {
      const current = await getConnectionById(database, database, request.connectionId, false);
      if (!current) notFound();
      if (current.status === "revoked") return current;
      return updateConnection(database, request.connectionId, request.expectedVersion, {
        clearCredential: true,
        expiresAt: null,
        now: request.now,
        permissionFence: request.permissionFence,
        status: "revoked",
      });
    },
    rotateCredential: (request) =>
      updateConnection(database, request.connectionId, request.expectedVersion, {
        expectedCredentialRef: request.expectedCredentialRef,
        expiresAt: request.expiresAt ?? null,
        newCredentialRef: request.newCredentialRef,
        now: request.now,
        permissionFence: request.permissionFence,
        scopes: request.scopes,
        status: "active",
      }),
    get: async ({ connectionId, knowledgeSpaceId, tenantId }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [connectionId, tenantId, knowledgeSpaceId],
        sql: `SELECT * FROM ${q(database, connectionTable)} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} LIMIT 1;`,
        tableName: connectionTable,
      });
      return result.rows[0] ? mapConnection(result.rows[0]) : null;
    },
    list: async ({ cursor, knowledgeSpaceId, limit, tenantId }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new SourceConnectionError(
          "SOURCE_CONNECTION_LIST_LIMIT_INVALID",
          `Source connection list limit must be 1-${maxListLimit}`,
        );
      }
      const after = cursor ? decodeConnectionCursor(cursor) : undefined;
      const pageLimit = limit + 1;
      const result = await database.execute({
        maxRows: pageLimit,
        operation: "select",
        params: [
          tenantId,
          knowledgeSpaceId,
          ...(after ? [after.createdAt, after.id] : []),
          pageLimit,
        ],
        sql: `SELECT * FROM ${q(database, connectionTable)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${after ? ` AND (${q(database, "created_at")} > ${p(database, 3)} OR (${q(database, "created_at")} = ${p(database, 3)} AND ${q(database, "id")} > ${p(database, 4)}))` : ""} ORDER BY ${q(database, "created_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, after ? 5 : 3)};`,
        tableName: connectionTable,
      });
      const connections = result.rows.map(mapConnection);
      const page = connections.slice(0, limit);
      const next = connections.length > limit ? page.at(-1) : undefined;
      return {
        items: page,
        ...(next ? { nextCursor: encodeConnectionCursor(next) } : {}),
      };
    },
    beginOAuth: async (transaction) => {
      const columns = [
        "id",
        "tenant_id",
        "knowledge_space_id",
        "connection_id",
        "requested_by_subject_id",
        "access_channel",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        "api_key_id",
        "state_hash",
        "verifier_ref",
        "redirect_uri",
        "status",
        "created_at",
        "expires_at",
      ] as const;
      const values: DatabaseQueryValue[] = [
        transaction.id,
        transaction.tenantId,
        transaction.knowledgeSpaceId,
        transaction.connectionId,
        transaction.requestedBySubjectId,
        transaction.accessChannel,
        transaction.permissionSnapshotId,
        transaction.permissionSnapshotRevision,
        transaction.apiKeyId ?? null,
        transaction.stateHash,
        transaction.verifierRef,
        transaction.redirectUri,
        transaction.status,
        transaction.createdAt,
        transaction.expiresAt,
      ];
      await database.transaction(async (tx) => {
        await requireSpaceAdmission(database, tx, transaction);
        await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: tx,
          fence: {
            accessChannel: transaction.accessChannel,
            knowledgeSpaceId: transaction.knowledgeSpaceId,
            permissionSnapshotId: transaction.permissionSnapshotId,
            permissionSnapshotRevision: transaction.permissionSnapshotRevision,
            requestedBySubjectId: transaction.requestedBySubjectId,
            tenantId: transaction.tenantId,
          },
          now: transaction.createdAt,
          requiredAccess: "write",
        });
        const connection = await getConnectionById(database, tx, transaction.connectionId, true);
        if (
          !connection ||
          connection.tenantId !== transaction.tenantId ||
          connection.knowledgeSpaceId !== transaction.knowledgeSpaceId
        ) {
          notFound();
        }
        await tx.execute({
          maxRows: 0,
          operation: "insert",
          params: values,
          sql: `INSERT INTO ${q(database, oauthTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${values.map((_, index) => p(database, index + 1)).join(", ")});`,
          tableName: oauthTable,
        });
        await insertSecretRef(
          database,
          tx,
          {
            connectionId: connection.id,
            credentialRef: transaction.verifierRef,
            id: randomUUID(),
            knowledgeSpaceId: connection.knowledgeSpaceId,
            providerId: connection.providerId,
            purpose: "oauth-pkce",
            recoverAfter: transaction.expiresAt,
            remoteRevokeRequired: false,
            rowVersion: 1,
            state: "staged",
            tenantId: connection.tenantId,
          },
          transaction.createdAt,
        );
      });
    },
    claimOAuthCallback: async ({
      accessChannel,
      apiKeyId,
      now,
      requestedBySubjectId,
      stateHash,
      tenantId,
    }) => {
      const candidate = await findOAuthByState(database, database, stateHash, now, false);
      if (
        !candidate ||
        candidate.tenantId !== tenantId ||
        candidate.requestedBySubjectId !== requestedBySubjectId ||
        candidate.accessChannel !== accessChannel ||
        candidate.apiKeyId !== apiKeyId
      )
        return null;
      return database.transaction(async (tx) => {
        await requireSpaceAdmission(database, tx, candidate);
        const result = await tx.execute({
          maxRows: 1,
          operation: "select",
          params: [stateHash, now, tenantId, requestedBySubjectId, accessChannel, apiKeyId ?? null],
          sql: `SELECT * FROM ${q(database, oauthTable)} WHERE ${q(database, "state_hash")} = ${p(database, 1)} AND ${q(database, "status")} = 'pending' AND ${q(database, "expires_at")} > ${p(database, 2)} AND ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${q(database, "access_channel")} = ${p(database, 5)} AND ((${q(database, "api_key_id")} IS NULL AND ${p(database, 6)} IS NULL) OR ${q(database, "api_key_id")} = ${p(database, 6)}) LIMIT 1 FOR UPDATE;`,
          tableName: oauthTable,
        });
        const row = result.rows[0];
        if (!row) return null;
        const transaction = mapOAuth(row);
        const updated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [now, transaction.id],
          sql: `UPDATE ${q(database, oauthTable)} SET ${q(database, "status")} = 'exchanging', ${q(database, "consumed_at")} = ${p(database, 1)} WHERE ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} = 'pending';`,
          tableName: oauthTable,
        });
        if (updated.rowsAffected !== 1) return null;
        const exchangeRecoverAfter = new Date(Date.parse(now) + 5 * 60_000).toISOString();
        await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [exchangeRecoverAfter, now, transaction.verifierRef],
          sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "recover_after")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "credential_ref")} = ${p(database, 3)} AND ${q(database, "state")} = 'staged';`,
          tableName: secretRefTable,
        });
        return { ...transaction, status: "exchanging" };
      });
    },
    completeOAuth: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      expiresAt,
      now,
      scopes,
      transactionId,
    }) => {
      const candidate = await getOAuthById(database, database, transactionId, false);
      if (!candidate) conflict();
      return database.transaction(async (tx) => {
        await requireSpaceAdmission(database, tx, candidate);
        await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: tx,
          fence: {
            accessChannel: candidate.accessChannel,
            knowledgeSpaceId: candidate.knowledgeSpaceId,
            permissionSnapshotId: candidate.permissionSnapshotId,
            permissionSnapshotRevision: candidate.permissionSnapshotRevision,
            requestedBySubjectId: candidate.requestedBySubjectId,
            tenantId: candidate.tenantId,
          },
          now,
          requiredAccess: "write",
        });
        const connection = await getConnectionById(database, tx, connectionId, true);
        if (
          !connection ||
          connection.id !== candidate.connectionId ||
          connection.version !== expectedVersion ||
          connection.status === "revoked"
        ) {
          conflict();
        }
        const current = await getOAuthById(database, tx, transactionId, true);
        if (!current || current.status !== "exchanging" || current.connectionId !== connection.id) {
          conflict();
        }
        if (
          current.tenantId !== candidate.tenantId ||
          current.knowledgeSpaceId !== candidate.knowledgeSpaceId ||
          current.accessChannel !== candidate.accessChannel ||
          current.permissionSnapshotId !== candidate.permissionSnapshotId ||
          current.permissionSnapshotRevision !== candidate.permissionSnapshotRevision ||
          current.requestedBySubjectId !== candidate.requestedBySubjectId
        ) {
          conflict();
        }
        const credential = await getSecretRefByCredential(database, tx, credentialRef, true);
        if (
          !credential ||
          credential.connectionId !== connection.id ||
          credential.purpose !== "connection-credential" ||
          credential.state !== "staged"
        ) {
          lifecycleConflict();
        }
        const next: SourceConnection = {
          ...connection,
          credentialRef,
          ...(expiresAt ? { expiresAt } : {}),
          lastErrorCode: undefined,
          scopes: [...scopes],
          status: "active",
          updatedAt: now,
          version: connection.version + 1,
        };
        const activated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [
            JSON.stringify(next.scopes),
            next.expiresAt ?? null,
            credentialRef,
            next.version,
            now,
            connection.id,
            expectedVersion,
          ],
          sql: `UPDATE ${q(database, connectionTable)} SET ${q(database, "status")} = 'active', ${q(database, "scopes")} = ${jsonValue(database, 1)}, ${q(database, "expires_at")} = ${p(database, 2)}, ${q(database, "credential_ref")} = ${p(database, 3)}, ${q(database, "last_error_code")} = NULL, ${q(database, "version")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "id")} = ${p(database, 6)} AND ${q(database, "version")} = ${p(database, 7)};`,
          tableName: connectionTable,
        });
        if (activated.rowsAffected !== 1) conflict();
        await setSecretRefActive(database, tx, credential, now);
        const result = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [now, transactionId],
          sql: `UPDATE ${q(database, oauthTable)} SET ${q(database, "status")} = 'completed', ${q(database, "completed_at")} = ${p(database, 1)} WHERE ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} = 'exchanging';`,
          tableName: oauthTable,
        });
        if (result.rowsAffected !== 1) conflict();
        await retireSecretRef(database, tx, current.verifierRef, now, false);
        return next;
      });
    },
    reserveCredential: async ({
      connectionId,
      credentialRef,
      expectedVersion,
      now,
      permissionFence,
      recoverAfter,
    }) => {
      const candidate = await getConnectionById(database, database, connectionId, false);
      if (!candidate) notFound();
      await database.transaction(async (tx) => {
        await requireSpaceAdmission(database, tx, candidate);
        await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: tx,
          fence: permissionFence,
          now,
          requiredAccess: "write",
        });
        const connection = await getConnectionById(database, tx, connectionId, true);
        if (
          !connection ||
          connection.version !== expectedVersion ||
          connection.status === "revoked"
        ) {
          conflict();
        }
        const existing = await getSecretRefByCredential(database, tx, credentialRef, true);
        if (existing) {
          if (
            existing.connectionId !== connection.id ||
            existing.purpose !== "connection-credential"
          ) {
            lifecycleConflict();
          }
          return;
        }
        await insertSecretRef(
          database,
          tx,
          {
            connectionId: connection.id,
            credentialRef,
            id: randomUUID(),
            knowledgeSpaceId: connection.knowledgeSpaceId,
            providerId: connection.providerId,
            purpose: "connection-credential",
            recoverAfter,
            remoteRevokeRequired: false,
            rowVersion: 1,
            state: "staged",
            tenantId: connection.tenantId,
          },
          now,
        );
      });
    },
    claimSecretCleanup: async ({ leaseExpiresAt, limit, now, workerId }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Connection secret cleanup limit must be 1-100");
      }
      return database.transaction(async (tx) => {
        // OAuth codes cannot safely be replayed after a worker dies mid-exchange. Expire the
        // durable transaction and retire its verifier so a later cleanup lease can remove it.
        const staleExchangeBefore = new Date(Date.parse(now) - 5 * 60_000).toISOString();
        const staleOAuth = await tx.execute({
          maxRows: limit,
          operation: "select",
          params: [now, staleExchangeBefore, limit],
          sql: `SELECT ${q(database, "id")}, ${q(database, "verifier_ref")} FROM ${q(database, oauthTable)} WHERE (${q(database, "status")} = 'pending' AND ${q(database, "expires_at")} <= ${p(database, 1)}) OR (${q(database, "status")} = 'exchanging' AND ${q(database, "consumed_at")} <= ${p(database, 2)}) ORDER BY ${q(database, "expires_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 3)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: oauthTable,
        });
        for (const row of staleOAuth.rows) {
          const oauthId = stringColumn(row, "id");
          const verifierRef = stringColumn(row, "verifier_ref");
          await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [now, oauthId],
            sql: `UPDATE ${q(database, oauthTable)} SET ${q(database, "status")} = 'failed', ${q(database, "consumed_at")} = COALESCE(${q(database, "consumed_at")}, ${p(database, 1)}) WHERE ${q(database, "id")} = ${p(database, 2)} AND ${q(database, "status")} IN ('pending', 'exchanging');`,
            tableName: oauthTable,
          });
          await retireSecretRef(database, tx, verifierRef, now, false);
        }
        const result = await tx.execute({
          maxRows: limit,
          operation: "select",
          params: [now, now, limit],
          sql: `SELECT * FROM ${q(database, secretRefTable)} WHERE (((${q(database, "state")} = 'retired' OR ${q(database, "state")} = 'staged') AND COALESCE(${q(database, "next_attempt_at")}, ${q(database, "recover_after")}) <= ${p(database, 1)}) OR (${q(database, "state")} = 'deleting' AND ${q(database, "lease_expires_at")} <= ${p(database, 2)})) ORDER BY COALESCE(${q(database, "next_attempt_at")}, ${q(database, "recover_after")}) ASC, ${q(database, "id")} ASC LIMIT ${p(database, 3)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: secretRefTable,
        });
        const claimed: SourceConnectionSecretRef[] = [];
        for (const row of result.rows) {
          const current = mapSecretRef(row);
          const leaseToken = randomUUID();
          const updated = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [
              workerId,
              leaseToken,
              leaseExpiresAt,
              current.rowVersion + 1,
              now,
              current.id,
              current.rowVersion,
            ],
            sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "state")} = 'deleting', ${q(database, "worker_id")} = ${p(database, 1)}, ${q(database, "lease_token")} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "id")} = ${p(database, 6)} AND ${q(database, "row_version")} = ${p(database, 7)};`,
            tableName: secretRefTable,
          });
          if (updated.rowsAffected === 1) {
            claimed.push({
              ...current,
              leaseExpiresAt,
              leaseToken,
              rowVersion: current.rowVersion + 1,
              state: "deleting",
              workerId,
            });
          }
        }
        return claimed;
      });
    },
    completeSecretCleanup: async ({ leaseToken, now, refId, rowVersion, workerId }) => {
      const result = await database.execute({
        maxRows: 0,
        operation: "update",
        params: [rowVersion + 1, now, now, refId, rowVersion, workerId, leaseToken],
        sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "state")} = 'deleted', ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "row_version")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "deleted_at")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(database, "worker_id")} = ${p(database, 6)} AND ${q(database, "lease_token")} = ${p(database, 7)} AND ${q(database, "state")} = 'deleting';`,
        tableName: secretRefTable,
      });
      if (result.rowsAffected !== 1) cleanupFenceConflict();
    },
    failSecretCleanup: async ({
      errorCode,
      leaseToken,
      nextAttemptAt,
      now,
      refId,
      rowVersion,
      workerId,
    }) => {
      const result = await database.execute({
        maxRows: 0,
        operation: "update",
        params: [
          nextAttemptAt,
          errorCode,
          rowVersion + 1,
          now,
          refId,
          rowVersion,
          workerId,
          leaseToken,
        ],
        sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "state")} = 'retired', ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "next_attempt_at")} = ${p(database, 1)}, ${q(database, "last_error_code")} = ${p(database, 2)}, ${q(database, "row_version")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)} AND ${q(database, "worker_id")} = ${p(database, 7)} AND ${q(database, "lease_token")} = ${p(database, 8)} AND ${q(database, "state")} = 'deleting';`,
        tableName: secretRefTable,
      });
      if (result.rowsAffected !== 1) cleanupFenceConflict();
    },
  };
}

interface ConnectionPatch {
  readonly clearCredential?: boolean;
  readonly expectedCredentialRef?: string;
  readonly expiresAt?: string | null;
  readonly lastErrorCode?: string | null;
  readonly newCredentialRef?: string;
  readonly now: string;
  readonly permissionFence?: SourceConnectionPermissionFence;
  readonly scopes?: readonly string[];
  readonly status: SourceConnection["status"];
}

async function updateConnection(
  database: DatabaseAdapter,
  connectionId: string,
  expectedVersion: number,
  patch: ConnectionPatch,
): Promise<SourceConnection> {
  const candidate = await getConnectionById(database, database, connectionId, false);
  if (!candidate) notFound();
  return database.transaction(async (tx) => {
    await requireSpaceAdmission(database, tx, candidate);
    if (patch.permissionFence) {
      await assertDatabaseKnowledgeSpacePermissionFence({
        database,
        executor: tx,
        fence: patch.permissionFence,
        now: patch.now,
        requiredAccess: "write",
      });
    }
    const current = await getConnectionById(database, tx, connectionId, true);
    if (!current) notFound();
    if (
      current.version !== expectedVersion ||
      (patch.expectedCredentialRef !== undefined &&
        current.credentialRef !== patch.expectedCredentialRef)
    ) {
      conflict();
    }
    const next: SourceConnection = {
      ...current,
      ...(patch.clearCredential
        ? { credentialRef: undefined }
        : patch.newCredentialRef
          ? { credentialRef: patch.newCredentialRef }
          : {}),
      ...(patch.expiresAt === undefined
        ? {}
        : patch.expiresAt === null
          ? { expiresAt: undefined }
          : { expiresAt: patch.expiresAt }),
      ...(patch.lastErrorCode === undefined
        ? {}
        : patch.lastErrorCode === null
          ? { lastErrorCode: undefined }
          : { lastErrorCode: patch.lastErrorCode }),
      ...(patch.scopes ? { scopes: [...patch.scopes] } : {}),
      status: patch.status,
      updatedAt: patch.now,
      version: current.version + 1,
    };
    const result = await tx.execute({
      maxRows: 0,
      operation: "update",
      params: [
        next.status,
        JSON.stringify(next.scopes),
        next.credentialRef ?? null,
        next.expiresAt ?? null,
        next.lastErrorCode ?? null,
        next.version,
        next.updatedAt,
        connectionId,
        expectedVersion,
        ...(patch.expectedCredentialRef ? [patch.expectedCredentialRef] : []),
      ],
      sql: `UPDATE ${q(database, connectionTable)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "scopes")} = ${jsonValue(database, 2)}, ${q(database, "credential_ref")} = ${p(database, 3)}, ${q(database, "expires_at")} = ${p(database, 4)}, ${q(database, "last_error_code")} = ${p(database, 5)}, ${q(database, "version")} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(database, 7)} WHERE ${q(database, "id")} = ${p(database, 8)} AND ${q(database, "version")} = ${p(database, 9)}${patch.expectedCredentialRef ? ` AND ${q(database, "credential_ref")} = ${p(database, 10)}` : ""};`,
      tableName: connectionTable,
    });
    if (result.rowsAffected !== 1) conflict();

    if (patch.newCredentialRef) {
      const nextSecret = await getSecretRefByCredential(database, tx, patch.newCredentialRef, true);
      const previousSecret = current.credentialRef
        ? await getSecretRefByCredential(database, tx, current.credentialRef, true)
        : null;
      if (
        !nextSecret ||
        nextSecret.connectionId !== current.id ||
        nextSecret.purpose !== "connection-credential" ||
        nextSecret.state !== "staged" ||
        !previousSecret ||
        previousSecret.connectionId !== current.id ||
        previousSecret.state !== "active"
      ) {
        lifecycleConflict();
      }
      await setSecretRefActive(database, tx, nextSecret, patch.now);
      await retireSecretRef(database, tx, previousSecret.credentialRef, patch.now, false);
    } else if (patch.clearCredential && current.credentialRef) {
      await retireSecretRef(
        database,
        tx,
        current.credentialRef,
        patch.now,
        current.authKind === "oauth2",
      );
    } else if (patch.status === "active" && current.credentialRef) {
      const lifecycle = await getSecretRefByCredential(database, tx, current.credentialRef, true);
      if (
        !lifecycle ||
        lifecycle.connectionId !== current.id ||
        (lifecycle.state !== "staged" && lifecycle.state !== "active")
      ) {
        lifecycleConflict();
      }
      if (lifecycle.state === "staged") {
        await setSecretRefActive(database, tx, lifecycle, patch.now);
      }
    } else if (patch.status === "error") {
      const staged = await tx.execute({
        maxRows: 1_000,
        operation: "select",
        params: [current.id],
        sql: `SELECT * FROM ${q(database, secretRefTable)} WHERE ${q(database, "connection_id")} = ${p(database, 1)} AND ${q(database, "state")} = 'staged' FOR UPDATE;`,
        tableName: secretRefTable,
      });
      for (const row of staged.rows) {
        await retireSecretRef(database, tx, mapSecretRef(row).credentialRef, patch.now, false);
      }
    }
    return next;
  });
}

async function getConnectionById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  connectionId: string,
  lock: boolean,
): Promise<SourceConnection | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [connectionId],
    sql: `SELECT * FROM ${q(database, connectionTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: connectionTable,
  });
  return result.rows[0] ? mapConnection(result.rows[0]) : null;
}

async function findOAuthByState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  stateHash: string,
  now: string,
  lock: boolean,
): Promise<SourceOAuthTransaction | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [stateHash, now],
    sql: `SELECT * FROM ${q(database, oauthTable)} WHERE ${q(database, "state_hash")} = ${p(database, 1)} AND ${q(database, "status")} = 'pending' AND ${q(database, "expires_at")} > ${p(database, 2)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: oauthTable,
  });
  return result.rows[0] ? mapOAuth(result.rows[0]) : null;
}

async function getOAuthById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  transactionId: string,
  lock: boolean,
): Promise<SourceOAuthTransaction | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [transactionId],
    sql: `SELECT * FROM ${q(database, oauthTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: oauthTable,
  });
  return result.rows[0] ? mapOAuth(result.rows[0]) : null;
}

async function requireSpaceAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw new SourceConnectionError(
      "SOURCE_CONNECTION_DELETION_FENCED",
      "Knowledge space is unavailable for source connection mutation",
    );
  }
}

async function insertSecretRef(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  ref: SourceConnectionSecretRef & { readonly recoverAfter: string },
  now: string,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "connection_id",
    "provider_id",
    "credential_ref",
    "purpose",
    "state",
    "remote_revoke_required",
    "recover_after",
    "row_version",
    "created_at",
    "updated_at",
  ] as const;
  const values: DatabaseQueryValue[] = [
    ref.id,
    ref.tenantId,
    ref.knowledgeSpaceId,
    ref.connectionId,
    ref.providerId,
    ref.credentialRef,
    ref.purpose,
    ref.state,
    ref.remoteRevokeRequired,
    ref.recoverAfter,
    ref.rowVersion,
    now,
    now,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `INSERT INTO ${q(database, secretRefTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${values.map((_, index) => p(database, index + 1)).join(", ")});`,
    tableName: secretRefTable,
  });
}

async function getSecretRefByCredential(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  credentialRef: string,
  lock: boolean,
): Promise<SourceConnectionSecretRef | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [credentialRef],
    sql: `SELECT * FROM ${q(database, secretRefTable)} WHERE ${q(database, "credential_ref")} = ${p(database, 1)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: secretRefTable,
  });
  return result.rows[0] ? mapSecretRef(result.rows[0]) : null;
}

async function setSecretRefActive(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  ref: SourceConnectionSecretRef,
  now: string,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [ref.rowVersion + 1, now, ref.id, ref.rowVersion],
    sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "state")} = 'active', ${q(database, "row_version")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(database, "state")} IN ('staged', 'active');`,
    tableName: secretRefTable,
  });
  if (result.rowsAffected !== 1) lifecycleConflict();
}

async function retireSecretRef(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  credentialRef: string,
  now: string,
  remoteRevokeRequired: boolean,
): Promise<void> {
  const ref = await getSecretRefByCredential(database, executor, credentialRef, true);
  if (!ref || ref.state === "deleted") return;
  if (ref.state === "deleting") lifecycleConflict();
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [remoteRevokeRequired, now, ref.rowVersion + 1, now, ref.id, ref.rowVersion],
    sql: `UPDATE ${q(database, secretRefTable)} SET ${q(database, "state")} = 'retired', ${q(database, "remote_revoke_required")} = CASE WHEN ${q(database, "remote_revoke_required")} THEN TRUE ELSE ${p(database, 1)} END, ${q(database, "recover_after")} = ${p(database, 2)}, ${q(database, "next_attempt_at")} = NULL, ${q(database, "row_version")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)} AND ${q(database, "state")} IN ('staged', 'active', 'retired');`,
    tableName: secretRefTable,
  });
  if (result.rowsAffected !== 1) lifecycleConflict();
}

function mapConnection(row: DatabaseRow): SourceConnection {
  const credentialRef = optionalStringColumn(row, "credential_ref");
  const expiresAt = optionalStringColumn(row, "expires_at");
  const lastErrorCode = optionalStringColumn(row, "last_error_code");
  const authKind = stringColumn(row, "auth_kind");
  const status = stringColumn(row, "status");
  if (!(["api-key", "endpoint", "oauth2"] as const).includes(authKind as never)) {
    throw new Error("Stored source connection auth kind is invalid");
  }
  if (
    !(["provisioning", "active", "expired", "error", "revoked"] as const).includes(status as never)
  ) {
    throw new Error("Stored source connection status is invalid");
  }
  return {
    authKind: authKind as SourceConnection["authKind"],
    configuration: jsonObjectColumn(row, "configuration") as Record<
      string,
      boolean | number | string
    >,
    createdAt: stringColumn(row, "created_at"),
    ...(credentialRef ? { credentialRef } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    name: stringColumn(row, "name"),
    providerId: stringColumn(row, "provider_id"),
    scopes: jsonStringArrayColumn(row, "scopes"),
    status: status as SourceConnection["status"],
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    version: numberColumn(row, "version"),
  };
}

function mapOAuth(row: DatabaseRow): SourceOAuthTransaction {
  const status = stringColumn(row, "status");
  if (!(["pending", "exchanging", "completed", "failed"] as const).includes(status as never)) {
    throw new Error("Stored OAuth transaction status is invalid");
  }
  return {
    accessChannel: sourceAccessChannel(row),
    ...(optionalStringColumn(row, "api_key_id")
      ? { apiKeyId: optionalStringColumn(row, "api_key_id") as string }
      : {}),
    connectionId: stringColumn(row, "connection_id"),
    createdAt: stringColumn(row, "created_at"),
    expiresAt: stringColumn(row, "expires_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    permissionSnapshotId: stringColumn(row, "permission_snapshot_id"),
    permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision"),
    redirectUri: stringColumn(row, "redirect_uri"),
    requestedBySubjectId: stringColumn(row, "requested_by_subject_id"),
    stateHash: stringColumn(row, "state_hash"),
    status: status as SourceOAuthTransaction["status"],
    tenantId: stringColumn(row, "tenant_id"),
    verifierRef: stringColumn(row, "verifier_ref"),
  };
}

function sourceAccessChannel(row: DatabaseRow): SourceOAuthTransaction["accessChannel"] {
  const value = stringColumn(row, "access_channel");
  if (
    !(value === "interactive" || value === "service_api" || value === "mcp" || value === "agent")
  ) {
    throw new Error("Stored OAuth access channel is invalid");
  }
  return value;
}

function mapSecretRef(row: DatabaseRow): SourceConnectionSecretRef {
  const purpose = stringColumn(row, "purpose");
  const state = stringColumn(row, "state");
  if (!(purpose === "connection-credential" || purpose === "oauth-pkce")) {
    throw new Error("Stored source connection secret purpose is invalid");
  }
  if (
    !(
      state === "staged" ||
      state === "active" ||
      state === "retired" ||
      state === "deleting" ||
      state === "deleted"
    )
  ) {
    throw new Error("Stored source connection secret state is invalid");
  }
  const leaseExpiresAt = optionalStringColumn(row, "lease_expires_at");
  const leaseToken = optionalStringColumn(row, "lease_token");
  const workerId = optionalStringColumn(row, "worker_id");
  const rawRemote = row.remote_revoke_required;
  if (typeof rawRemote !== "boolean" && rawRemote !== 0 && rawRemote !== 1) {
    throw new Error("Stored source connection remote revoke flag is invalid");
  }
  return {
    connectionId: stringColumn(row, "connection_id"),
    credentialRef: stringColumn(row, "credential_ref"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(leaseToken ? { leaseToken } : {}),
    providerId: stringColumn(row, "provider_id"),
    purpose,
    remoteRevokeRequired: rawRemote === true || rawRemote === 1,
    rowVersion: numberColumn(row, "row_version"),
    state,
    tenantId: stringColumn(row, "tenant_id"),
    ...(workerId ? { workerId } : {}),
  };
}

function notFound(): never {
  throw new SourceConnectionError("SOURCE_CONNECTION_NOT_FOUND", "Source connection not found");
}

function conflict(): never {
  throw new SourceConnectionError(
    "SOURCE_CONNECTION_VERSION_CONFLICT",
    "Source connection changed concurrently",
  );
}

function lifecycleConflict(): never {
  throw new SourceConnectionError(
    "SOURCE_CONNECTION_SECRET_LIFECYCLE_CONFLICT",
    "Source connection secret lifecycle changed concurrently",
  );
}

function cleanupFenceConflict(): never {
  throw new SourceConnectionError(
    "SOURCE_CONNECTION_SECRET_CLEANUP_FENCE_CONFLICT",
    "Source connection secret cleanup lease changed concurrently",
  );
}

function q(database: DatabaseAdapter, value: string): string {
  return quoteDatabaseIdentifier(database, value);
}

function p(database: DatabaseAdapter, index: number): string {
  return databasePlaceholder(database, index);
}

function jsonValue(database: DatabaseAdapter, index: number): string {
  const placeholder = p(database, index);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
