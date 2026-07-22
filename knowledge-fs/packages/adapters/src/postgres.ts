import type {
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  DatabaseTransactionRunner,
} from "@knowledge/core";
import { Pool } from "pg";

export interface PostgresPoolLike {
  connect?: () => Promise<PostgresClientLike>;
  end?: () => Promise<void>;
  query(input: PostgresQueryInput): Promise<PostgresQueryResult>;
}

export interface PostgresClientLike {
  query(input: PostgresQueryInput): Promise<PostgresQueryResult>;
  release?(error?: Error | boolean): void;
}

export interface PostgresQueryInput {
  readonly text: string;
  readonly values: readonly DatabaseQueryValue[];
}

export interface PostgresQueryResult {
  readonly rowCount?: number | null;
  readonly rows?: readonly DatabaseRow[];
}

export interface PostgresDatabaseExecutorOptions {
  readonly pool: PostgresPoolLike;
}

export interface CreatePostgresPoolOptions {
  readonly connectionString: string;
  readonly connectionTimeoutMillis?: number | undefined;
  readonly idleTimeoutMillis?: number | undefined;
  readonly max?: number | undefined;
}

export function createPostgresDatabaseExecutor({
  pool,
}: PostgresDatabaseExecutorOptions): DatabaseExecutor & DatabaseTransactionRunner {
  return {
    execute: createPostgresExecute(pool),
    transaction: async (callback) => {
      if (!pool.connect) {
        throw new Error("PostgreSQL transactions require a connection-capable pool");
      }

      const client = await pool.connect();
      let rollbackError: Error | undefined;

      try {
        await client.query({ text: "BEGIN", values: [] });
        const result = await callback({ execute: createPostgresExecute(client) });
        await client.query({ text: "COMMIT", values: [] });

        return result;
      } catch (error) {
        try {
          await client.query({ text: "ROLLBACK", values: [] });
        } catch (rollbackFailure) {
          rollbackError = normalizeError(rollbackFailure);
        }
        throw error;
      } finally {
        client.release?.(rollbackError);
      }
    },
  };
}

function normalizeError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function createPostgresExecute(
  queryable: Pick<PostgresPoolLike, "query">,
): DatabaseExecutor["execute"] {
  return async (input) => {
    const result = await queryable.query({
      text: input.sql,
      values: [...input.params],
    });
    const rows = (result.rows ?? []).map((row) => normalizePostgresRow(row));

    return {
      rows,
      rowsAffected: result.rowCount ?? rows.length,
    };
  };
}

function normalizePostgresRow(row: DatabaseRow): DatabaseRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

export function createPostgresPool({
  connectionString,
  connectionTimeoutMillis = 5_000,
  idleTimeoutMillis = 10_000,
  max = 10,
}: CreatePostgresPoolOptions): PostgresPoolLike {
  return new Pool({
    connectionString,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    max,
  });
}

export async function checkPostgresHealth(pool: PostgresPoolLike): Promise<boolean> {
  try {
    await pool.query({ text: "SELECT 1;", values: [] });
    return true;
  } catch {
    return false;
  }
}
