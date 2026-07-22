import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  EvidenceBundleSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  assertEvidenceBundleScopeReady,
  createDatabaseEvidenceBundleRepository,
  purgeUnscopedEvidenceBundlesPageWithExecutor,
} from "./evidence-bundle-database-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const bundle = EvidenceBundleSchema.parse({
  createdAt: "2026-07-14T00:00:00.000Z",
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
  items: [
    {
      citations: [{ documentAssetId, documentVersion: 1, sectionPath: [] }],
      conflicts: [],
      freshness: { status: "fresh" },
      metadata: {},
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      score: 0.9,
      scores: { final: 0.9, retrieval: 0.8 },
      text: "Scoped evidence",
    },
  ],
  missingEvidence: [],
  query: "What is scoped?",
  state: "answerable",
});

describe("database evidence bundle scoping", () => {
  it.each(["postgres", "tidb"] as const)(
    "locks the space, validates citations, and writes mandatory scope atomically in %s",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: knowledgeSpaceId }], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          return { rows: [{ id: documentAssetId }], rowsAffected: 1 };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async (callback) => callback({ execute: executor }),
      });

      await expect(
        createDatabaseEvidenceBundleRepository({ database }).create({
          bundle,
          knowledgeSpaceId,
          tenantId,
        }),
      ).resolves.toEqual(bundle);

      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "knowledge_spaces"],
        ["select", "document_assets"],
        ["select", "evidence_bundles"],
        ["insert", "evidence_bundles"],
      ]);
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[1]?.sql).toContain("lifecycle_state");
      const insert = calls[3] as DatabaseExecuteInput;
      expect(insert.params).toContain(tenantId);
      expect(insert.params).toContain(knowledgeSpaceId);
      expect(insert.sql).toContain("deletion_jobs");
      expect(insert.sql).toContain("active_slot");
      assertPlaceholderArity(insert, kind);
    },
  );

  it("rejects a citation from another or deleting knowledge space before inserting", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return input.tableName === "knowledge_spaces"
        ? { rows: [{ id: knowledgeSpaceId }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor,
      kind: "postgres",
      transaction: async (callback) => callback({ execute: executor }),
    });

    await expect(
      createDatabaseEvidenceBundleRepository({ database }).create({
        bundle,
        knowledgeSpaceId,
        tenantId,
      }),
    ).rejects.toThrow("Evidence bundle references unavailable or cross-space documents");
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("fails reads closed unless the owning knowledge space is still active", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = createSchemaDatabaseAdapter({
      executor: async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      kind: "postgres",
    });

    await expect(
      createDatabaseEvidenceBundleRepository({ database }).get({
        id: bundle.id,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toBeNull();
    expect(calls[0]?.sql).toContain('FROM "knowledge_spaces" AS active_space');
    expect(calls[0]?.sql).toContain("active_space.\"lifecycle_state\" = 'active'");
    expect(calls[0]?.sql).toContain('active_space."deletion_job_id" IS NULL');
    expect(calls[0]?.sql).toContain("deletion_jobs");
  });

  it("fails readiness closed while any legacy bundle is unscoped", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return { rows: [{ id: bundle.id }], rowsAffected: 0 };
    };
    const database = createSchemaDatabaseAdapter({ executor, kind: "postgres" });

    await expect(assertEvidenceBundleScopeReady(database)).rejects.toThrow(
      "Durable deletion requires every evidence bundle",
    );
    expect(calls[0]?.sql).toContain("tenant_id");
    expect(calls[0]?.sql).toContain("knowledge_space_id");
    expect(calls[0]?.sql).toContain("IS NULL");
  });

  it.each(["postgres", "tidb"] as const)(
    "boundedly detaches and purges quarantined legacy bundles with caller executor in %s",
    async (kind) => {
      const calls: DatabaseExecuteInput[] = [];
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        return input.operation === "select"
          ? { rows: [{ id: bundle.id }], rowsAffected: 1 }
          : { rows: [], rowsAffected: 1 };
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async () => {
          throw new Error("must use caller transaction");
        },
      });

      await expect(
        purgeUnscopedEvidenceBundlesPageWithExecutor(database, { execute: executor }, { limit: 5 }),
      ).resolves.toBe(1);
      expect(calls.map((call) => [call.operation, call.tableName])).toEqual([
        ["select", "evidence_bundles"],
        ["update", "answer_traces"],
        ["delete", "evidence_bundles"],
      ]);
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[2]?.sql).toContain("IS NULL");
      if (kind === "tidb") {
        for (const call of calls) assertPlaceholderArity(call, kind);
      }
    },
  );
});

function assertPlaceholderArity(call: DatabaseExecuteInput, dialect: "postgres" | "tidb"): void {
  if (dialect === "tidb") {
    expect(call.sql.match(/\?/g) ?? []).toHaveLength(call.params.length);
    return;
  }
  const positions = [...call.sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  expect(Math.max(0, ...positions)).toBe(call.params.length);
}
