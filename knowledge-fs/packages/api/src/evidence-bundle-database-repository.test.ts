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
const deletingDocumentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
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
    "allows bundle writes during child-resource deletion while whole-space deletion still rejects in %s",
    async (kind) => {
      const createRepository = (activeTargetType: "knowledge_space" | "logical_document") => {
        const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "knowledge_spaces") {
            return { rows: [{ id: knowledgeSpaceId }], rowsAffected: 1 };
          }
          if (input.tableName === "document_assets") {
            return { rows: [activeDocumentRow()], rowsAffected: 1 };
          }
          if (input.tableName === "evidence_bundles" && input.operation === "select") {
            return { rows: [], rowsAffected: 0 };
          }
          if (input.tableName === "evidence_bundles" && input.operation === "insert") {
            const wholeSpaceFence = hasWholeSpaceDeletionFence(input.sql, kind, {
              idColumn: "knowledge_space_id",
              ownerAlias: "scoped_bundle",
            });
            return {
              rows: [],
              rowsAffected: activeTargetType === "knowledge_space" || !wholeSpaceFence ? 0 : 1,
            };
          }
          throw new Error(`Unexpected evidence-bundle query: ${input.tableName}`);
        };
        const database = createSchemaDatabaseAdapter({
          executor,
          kind,
          transaction: async (callback) => callback({ execute: executor }),
        });
        return createDatabaseEvidenceBundleRepository({ database });
      };

      await expect(
        createRepository("logical_document").create({ bundle, knowledgeSpaceId, tenantId }),
      ).resolves.toEqual(bundle);
      await expect(
        createRepository("knowledge_space").create({ bundle, knowledgeSpaceId, tenantId }),
      ).rejects.toThrow("Evidence bundle creation rejected by active durable deletion");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "persists mixed active/deleting citations as selective content-free tombstones in %s",
    async (kind) => {
      const mixed = mixedDocumentBundle();
      let insertedItems: unknown;
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "knowledge_spaces") {
          return { rows: [{ id: knowledgeSpaceId }], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          return {
            rows: [
              {
                deletion_job_id: null,
                id: documentAssetId,
                lifecycle_state: "active",
              },
              {
                deletion_job_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
                id: deletingDocumentAssetId,
                lifecycle_state: "deleting",
              },
            ],
            rowsAffected: 2,
          };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "evidence_bundles" && input.operation === "insert") {
          insertedItems = JSON.parse(String(input.params[6])) as unknown;
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected evidence-bundle query: ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor,
        kind,
        transaction: async (callback) => callback({ execute: executor }),
      });

      const created = await createDatabaseEvidenceBundleRepository({ database }).create({
        bundle: mixed,
        knowledgeSpaceId,
        tenantId,
      });

      expect(created.items[0]).toEqual(mixed.items[0]);
      expect(created.items[1]).toMatchObject({
        citations: [{ documentAssetId: deletingDocumentAssetId, sectionPath: [] }],
        conflicts: [],
        freshness: { status: "unknown" },
        metadata: {
          traceEvidenceAvailability: {
            reason: "document-deleted-or-unavailable",
            status: "unavailable",
          },
        },
        text: "Evidence deleted or unavailable",
      });
      expect(insertedItems).toEqual(created.items);
      expect(JSON.stringify(created.items[1])).not.toContain("deleting evidence text");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "projects a persisted physically-deleted citation instead of hiding the whole bundle in %s",
    async (kind) => {
      const mixed = mixedDocumentBundle();
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        if (input.tableName === "evidence_bundles") {
          return { rows: [evidenceBundleRow(mixed)], rowsAffected: 1 };
        }
        if (input.tableName === "document_assets") {
          return {
            rows: [
              {
                deletion_job_id: null,
                id: documentAssetId,
                lifecycle_state: "active",
              },
            ],
            rowsAffected: 1,
          };
        }
        throw new Error(`Unexpected evidence-bundle query: ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({ executor, kind });

      const loaded = await createDatabaseEvidenceBundleRepository({ database }).get({
        id: mixed.id,
        knowledgeSpaceId,
        tenantId,
      });

      expect(loaded?.items[0]).toEqual(mixed.items[0]);
      expect(loaded?.items[1]).toMatchObject({
        metadata: {
          traceEvidenceAvailability: {
            reason: "document-deleted-or-unavailable",
            status: "unavailable",
          },
        },
        text: "Evidence deleted or unavailable",
      });
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "keeps bundle reads visible during child-resource deletion but hides them for whole-space deletion in %s",
    async (kind) => {
      const createRepository = (activeTargetType: "knowledge_space" | "document_asset") => {
        const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
          if (input.tableName === "evidence_bundles") {
            const wholeSpaceFence = hasWholeSpaceDeletionFence(input.sql, kind, {
              idColumn: "knowledge_space_id",
              ownerAlias: "scoped_bundle",
            });
            return {
              rows:
                activeTargetType === "knowledge_space" || !wholeSpaceFence
                  ? []
                  : [evidenceBundleRow()],
              rowsAffected: 0,
            };
          }
          if (input.tableName === "document_assets") {
            return { rows: [activeDocumentRow()], rowsAffected: 1 };
          }
          throw new Error(`Unexpected evidence-bundle query: ${input.tableName}`);
        };
        const database = createSchemaDatabaseAdapter({ executor, kind });
        return createDatabaseEvidenceBundleRepository({ database });
      };

      await expect(
        createRepository("document_asset").get({ id: bundle.id, knowledgeSpaceId, tenantId }),
      ).resolves.toEqual(bundle);
      await expect(
        createRepository("knowledge_space").get({ id: bundle.id, knowledgeSpaceId, tenantId }),
      ).resolves.toBeNull();
    },
  );

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
          return { rows: [activeDocumentRow()], rowsAffected: 1 };
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
        ["select", "evidence_bundles"],
        ["select", "document_assets"],
        ["insert", "evidence_bundles"],
      ]);
      expect(calls[0]?.sql).toContain("FOR UPDATE");
      expect(calls[2]?.sql).toContain("lifecycle_state");
      const insert = calls[3] as DatabaseExecuteInput;
      expect(insert.params).toContain(tenantId);
      expect(insert.params).toContain(knowledgeSpaceId);
      expect(insert.sql).toContain("deletion_jobs");
      expect(insert.sql).toContain("active_slot");
      if (kind === "postgres") {
        expect(insert.sql).toContain('$1::uuid AS "id"');
        expect(insert.sql).toContain('$3::uuid AS "knowledge_space_id"');
        expect(insert.sql).toContain('$4::uuid AS "trace_id"');
        expect(insert.sql).toContain('$8::jsonb AS "missing_evidence"');
        expect(insert.sql).toContain('$9::timestamptz AS "created_at"');
        expect(insert.sql).toContain('$10::timestamptz AS "updated_at"');
      }
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

function evidenceBundleRow(candidate = bundle): Record<string, unknown> {
  return {
    created_at: candidate.createdAt,
    id: candidate.id,
    items: JSON.stringify(candidate.items),
    missing_evidence: JSON.stringify(candidate.missingEvidence),
    query: candidate.query,
    state: candidate.state,
    trace_id: null,
  };
}

function activeDocumentRow(): Record<string, unknown> {
  return { deletion_job_id: null, id: documentAssetId, lifecycle_state: "active" };
}

function mixedDocumentBundle() {
  return EvidenceBundleSchema.parse({
    ...bundle,
    items: [
      bundle.items[0],
      {
        citations: [
          {
            documentAssetId: deletingDocumentAssetId,
            documentVersion: 2,
            sectionPath: ["Deleted section"],
          },
        ],
        conflicts: [
          {
            reason: "sensitive old conflict",
            severity: "warning",
            withNodeId: bundle.items[0]?.nodeId,
          },
        ],
        freshness: { checkedAt: "2026-07-14T00:00:00.000Z", status: "fresh" },
        metadata: { oldSecret: "must-not-persist" },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
        score: 0.8,
        scores: { final: 0.8, retrieval: 0.7 },
        text: "deleting evidence text",
      },
    ],
  });
}

function hasWholeSpaceDeletionFence(
  sql: string,
  dialect: "postgres" | "tidb",
  input: { readonly idColumn: string; readonly ownerAlias: string },
): boolean {
  const quoted = (identifier: string) =>
    dialect === "postgres" ? `"${identifier}"` : `\`${identifier}\``;
  const quotedOwner = `${quoted(input.ownerAlias)}.${quoted(input.idColumn)}`;
  const unquotedOwner = `${input.ownerAlias}.${quoted(input.idColumn)}`;
  return (
    sql.includes(`active_deletion.${quoted("target_type")} = 'knowledge_space'`) &&
    (sql.includes(`active_deletion.${quoted("target_id")} = ${quotedOwner}`) ||
      sql.includes(`active_deletion.${quoted("target_id")} = ${unquotedOwner}`))
  );
}
