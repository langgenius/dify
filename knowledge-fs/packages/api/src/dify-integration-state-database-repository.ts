import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import {
  DifyIntegrationActivationConflictError,
  type DifyIntegrationActivationDecision,
  type DifyIntegrationState,
  type DifyIntegrationStateRepository,
  assertDifyIntegrationState,
  decideDifyIntegrationActivation,
} from "./dify-integration-state";

const tableName = "dify_integration_states";

export function createDatabaseDifyIntegrationStateRepository(options: {
  readonly database: DatabaseAdapter;
  readonly now?: (() => string) | undefined;
}): DifyIntegrationStateRepository {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    activate: async (input) =>
      options.database.transaction(async (transaction) => {
        const timestamp = now();
        const existing = await findState(options.database, transaction, input.namespaceId, true);
        let decision = decideDifyIntegrationActivation(existing, input, timestamp);
        if (decision.kind === "replay") return decision.result;
        if (decision.kind === "insert") {
          const inserted = await insertState(options.database, transaction, decision.result.state);
          if (inserted) return decision.result;
          const concurrent = await findState(
            options.database,
            transaction,
            input.namespaceId,
            true,
          );
          if (!concurrent) throw new DifyIntegrationActivationConflictError();
          decision = decideDifyIntegrationActivation(concurrent, input, timestamp);
          if (decision.kind === "replay") return decision.result;
        }
        if (decision.kind !== "update") throw new DifyIntegrationActivationConflictError();
        await updateState(options.database, transaction, decision);
        return decision.result;
      }),
    get: async (namespaceId) => {
      requireNamespaceId(namespaceId);
      return findState(options.database, options.database, namespaceId, false);
    },
  };
}

async function findState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  namespaceId: string,
  lock: boolean,
): Promise<DifyIntegrationState | null> {
  requireNamespaceId(namespaceId);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [namespaceId],
    sql: `SELECT * FROM ${q(database, tableName)} WHERE ${q(database, "tenant_id")} = ${p(
      database,
      1,
    )}${lock ? " FOR UPDATE" : ""}`,
    tableName,
  });
  return result.rows[0] ? stateFromRow(result.rows[0]) : null;
}

async function insertState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  state: DifyIntegrationState,
): Promise<boolean> {
  const columns = [
    "tenant_id",
    "activation_id",
    "activation_revision",
    "source_revision_digest",
    "activated_at",
    "updated_at",
  ] as const;
  const params: DatabaseQueryValue[] = [
    state.namespaceId,
    state.activationId,
    state.activationRevision,
    state.sourceRevisionDigest,
    state.activatedAt,
    state.updatedAt,
  ];
  const prefix = database.dialect === "postgres" ? "INSERT INTO" : "INSERT IGNORE INTO";
  const suffix =
    database.dialect === "postgres" ? ` ON CONFLICT (${q(database, "tenant_id")}) DO NOTHING` : "";
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${prefix} ${q(database, tableName)} (${columns
      .map((column) => q(database, column))
      .join(
        ", ",
      )}) VALUES (${columns.map((_, index) => p(database, index + 1)).join(", ")})${suffix}`,
    tableName,
  });
  return result.rowsAffected === 1;
}

async function updateState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  decision: Extract<DifyIntegrationActivationDecision, { readonly kind: "update" }>,
): Promise<void> {
  const state = decision.result.state;
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      state.activationId,
      state.activationRevision,
      state.sourceRevisionDigest,
      state.updatedAt,
      state.namespaceId,
      decision.previousRevision,
    ],
    sql: `UPDATE ${q(database, tableName)} SET ${q(database, "activation_id")} = ${p(
      database,
      1,
    )}, ${q(database, "activation_revision")} = ${p(database, 2)}, ${q(
      database,
      "source_revision_digest",
    )} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(
      database,
      4,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 5)} AND ${q(
      database,
      "activation_revision",
    )} = ${p(database, 6)}`,
    tableName,
  });
  if (result.rowsAffected !== 1) throw new DifyIntegrationActivationConflictError();
}

function stateFromRow(row: DatabaseRow): DifyIntegrationState {
  const state = {
    activatedAt: stringColumn(row, "activated_at"),
    activationId: stringColumn(row, "activation_id"),
    activationRevision: numberColumn(row, "activation_revision"),
    namespaceId: stringColumn(row, "tenant_id"),
    sourceRevisionDigest: stringColumn(row, "source_revision_digest"),
    updatedAt: stringColumn(row, "updated_at"),
  };
  assertDifyIntegrationState(state);
  return state;
}

function requireNamespaceId(value: string): void {
  if (value.length === 0 || value.length > 255 || value.trim() !== value) {
    throw new TypeError("namespaceId must be a non-empty normalized identifier");
  }
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
