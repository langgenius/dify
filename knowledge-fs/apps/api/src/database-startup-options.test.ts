import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { describe, expect, it, vi } from "vitest";

import {
  assertApiDatabaseConnectionReady,
  waitForApiDatabaseStartup,
} from "./database-startup-options";

const databaseUrl = "postgresql://knowledge-fs.example/knowledge_fs";

describe("waitForApiDatabaseStartup", () => {
  it("probes a declared base table so the schema adapter accepts the startup query", async () => {
    const execute = vi.fn(async () => ({ rows: [], rowsAffected: 0 }));
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
    });

    await assertApiDatabaseConnectionReady(database);

    expect(execute).toHaveBeenCalledWith({
      maxRows: 1,
      operation: "select",
      params: [],
      sql: "SELECT id FROM knowledge_spaces LIMIT 0;",
      tableName: "knowledge_spaces",
    });
  });

  it("retries PostgreSQL recovery errors until the database accepts connections", async () => {
    let attempts = 0;
    let now = 0;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });
    const onRetry = vi.fn();

    await waitForApiDatabaseStartup({
      env: {
        DATABASE_URL: databaseUrl,
        KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS: "1000",
        KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS: "5000",
      },
      now: () => now,
      onRetry,
      operation: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw postgresError("57P03", "the database system is in recovery mode");
        }
      },
      sleep,
    });

    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      code: "57P03",
      delayMs: 1000,
    });
    expect(onRetry).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      code: "57P03",
      delayMs: 1000,
    });
  });

  it("retries nested connection termination errors without a SQLSTATE", async () => {
    let attempts = 0;
    let now = 0;

    await waitForApiDatabaseStartup({
      env: {
        DATABASE_URL: databaseUrl,
        KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS: "250",
        KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS: "1000",
      },
      now: () => now,
      operation: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Connection terminated due to connection timeout", {
            cause: new Error("Connection terminated unexpectedly"),
          });
        }
      },
      sleep: async (delayMs) => {
        now += delayMs;
      },
    });

    expect(attempts).toBe(2);
  });

  it("fails immediately for non-connectivity startup validation errors", async () => {
    const sleep = vi.fn(async () => undefined);
    const validationError = new Error(
      "Durable deletion requires every evidence bundle to have an unambiguous tenant/space scope",
    );

    await expect(
      waitForApiDatabaseStartup({
        env: { DATABASE_URL: databaseUrl },
        operation: async () => {
          throw validationError;
        },
        sleep,
      }),
    ).rejects.toBe(validationError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("stops retrying when the configured startup deadline is exhausted", async () => {
    let attempts = 0;
    let now = 0;
    const unavailable = postgresError("08006", "connection failure");

    await expect(
      waitForApiDatabaseStartup({
        env: {
          DATABASE_URL: databaseUrl,
          KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS: "400",
          KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS: "1000",
        },
        now: () => now,
        operation: async () => {
          attempts += 1;
          throw unavailable;
        },
        sleep: async (delayMs) => {
          now += delayMs;
        },
      }),
    ).rejects.toBe(unavailable);

    expect(attempts).toBe(4);
    expect(now).toBe(1000);
  });

  it("skips the probe without DATABASE_URL and rejects invalid retry configuration", async () => {
    const operation = vi.fn(async () => undefined);

    await waitForApiDatabaseStartup({ env: {}, operation });
    expect(operation).not.toHaveBeenCalled();

    await expect(
      waitForApiDatabaseStartup({
        env: {
          DATABASE_URL: databaseUrl,
          KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS: "eventually",
        },
        operation,
      }),
    ).rejects.toThrow("KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS must be an integer of at least 1000");
  });
});

function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
