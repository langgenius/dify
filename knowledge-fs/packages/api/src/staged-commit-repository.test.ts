import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type KnowledgeSpaceStagedCommit,
  KnowledgeSpaceStagedCommitSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  InvalidStagedCommitTransitionError,
  StagedCommitCapacityExceededError,
  StagedCommitListLimitExceededError,
  createDatabaseStagedCommitRepository,
  createInMemoryStagedCommitRepository,
} from "./staged-commit-repository";

const TENANT_ID = "tenant-1";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const COMMIT_ID_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a10";
const COMMIT_ID_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a11";
const CREATED_AT = "2026-05-27T10:00:00.000Z";
const UPDATED_AT = "2026-05-27T10:05:00.000Z";

function stagedCommit(overrides: Partial<KnowledgeSpaceStagedCommit> = {}) {
  return KnowledgeSpaceStagedCommitSchema.parse({
    createdAt: CREATED_AT,
    id: COMMIT_ID_A,
    idempotencyKey: "upload:tenant-1:doc.md",
    knowledgeSpaceId: SPACE_ID,
    operationType: "document-upload",
    rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/doc.md`,
    status: "received",
    tenantId: TENANT_ID,
    updatedAt: CREATED_AT,
    ...overrides,
  });
}

describe("StagedCommit repositories", () => {
  it("creates commits idempotently by tenant, space, and idempotency key", async () => {
    const repository = createInMemoryStagedCommitRepository({
      maxCommits: 2,
      maxListLimit: 2,
    });

    const created = await repository.create(stagedCommit());
    const duplicate = await repository.create(
      stagedCommit({
        id: COMMIT_ID_B,
        rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/other.md`,
      }),
    );
    created.rawObjectKey = "tenant-1/spaces/mutated";

    expect(duplicate).toEqual(expect.objectContaining({ id: COMMIT_ID_A }));
    await expect(
      repository.get({ id: COMMIT_ID_A, knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      id: COMMIT_ID_A,
      rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/doc.md`,
    });
    await expect(
      repository.get({ id: COMMIT_ID_A, knowledgeSpaceId: SPACE_ID, tenantId: "other-tenant" }),
    ).resolves.toBeNull();
  });

  it("transitions commits through valid states and rejects regressions from terminal states", async () => {
    const repository = createInMemoryStagedCommitRepository({
      maxCommits: 2,
      maxListLimit: 2,
    });
    await repository.create(stagedCommit());

    await expect(
      repository.transition({
        id: COMMIT_ID_A,
        knowledgeSpaceId: SPACE_ID,
        patch: {
          checksum: "a".repeat(64),
          sizeBytes: 4096,
        },
        status: "object-verified",
        tenantId: TENANT_ID,
        updatedAt: UPDATED_AT,
      }),
    ).resolves.toMatchObject({
      checksum: "a".repeat(64),
      sizeBytes: 4096,
      status: "object-verified",
      updatedAt: UPDATED_AT,
    });

    await repository.transition({
      id: COMMIT_ID_A,
      knowledgeSpaceId: SPACE_ID,
      status: "published",
      tenantId: TENANT_ID,
      updatedAt: "2026-05-27T10:10:00.000Z",
    });

    await expect(
      repository.transition({
        id: COMMIT_ID_A,
        knowledgeSpaceId: SPACE_ID,
        status: "object-staged",
        tenantId: TENANT_ID,
        updatedAt: "2026-05-27T10:15:00.000Z",
      }),
    ).rejects.toBeInstanceOf(InvalidStagedCommitTransitionError);
  });

  it("lists commits with bounded stable pagination and optional status filtering", async () => {
    const repository = createInMemoryStagedCommitRepository({
      maxCommits: 3,
      maxListLimit: 1,
    });
    await repository.create(stagedCommit());
    await repository.create(
      stagedCommit({
        id: COMMIT_ID_B,
        idempotencyKey: "upload:tenant-1:other.md",
        rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/other.md`,
        status: "failed-retryable",
      }),
    );

    await expect(
      repository.list({ knowledgeSpaceId: SPACE_ID, limit: 2, tenantId: TENANT_ID }),
    ).rejects.toBeInstanceOf(StagedCommitListLimitExceededError);

    const first = await repository.list({
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      tenantId: TENANT_ID,
    });
    expect(first).toEqual({
      items: [expect.objectContaining({ id: COMMIT_ID_A })],
      nextCursor: COMMIT_ID_A,
    });
    await expect(
      repository.list({
        cursor: first.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: COMMIT_ID_B })],
    });
    await expect(
      repository.list({
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        status: "failed-retryable",
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: COMMIT_ID_B })],
    });
  });

  it("rejects invalid bounds and capacity overflow", async () => {
    expect(() => createInMemoryStagedCommitRepository({ maxCommits: 0, maxListLimit: 1 })).toThrow(
      "StagedCommit repository maxCommits must be at least 1",
    );
    expect(() => createInMemoryStagedCommitRepository({ maxCommits: 1, maxListLimit: 0 })).toThrow(
      "StagedCommit repository maxListLimit must be at least 1",
    );

    const repository = createInMemoryStagedCommitRepository({
      maxCommits: 1,
      maxListLimit: 1,
    });
    await repository.create(stagedCommit());

    await expect(
      repository.create(
        stagedCommit({
          id: COMMIT_ID_B,
          idempotencyKey: "upload:tenant-1:second.md",
          rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/second.md`,
        }),
      ),
    ).rejects.toBeInstanceOf(StagedCommitCapacityExceededError);
  });
});

describe.each(["postgres", "tidb"] as const)("DatabaseStagedCommitRepository (%s)", (kind) => {
  it("creates idempotently, reads/lists, and enforces legal transitions", async () => {
    const fake = createFakeStagedCommitDatabase(kind);
    const repository = createDatabaseStagedCommitRepository({
      database: fake.database,
      maxListLimit: 2,
    });
    const first = stagedCommit();
    const duplicateInput = stagedCommit({
      id: COMMIT_ID_B,
      rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/duplicate.md`,
    });

    await expect(repository.create(first)).resolves.toMatchObject({ id: COMMIT_ID_A });
    await expect(repository.create(duplicateInput)).resolves.toMatchObject({
      id: COMMIT_ID_A,
      rawObjectKey: first.rawObjectKey,
    });
    await expect(
      repository.get({ id: COMMIT_ID_A, knowledgeSpaceId: SPACE_ID, tenantId: "other-tenant" }),
    ).resolves.toBeNull();

    await repository.create(
      stagedCommit({
        id: COMMIT_ID_B,
        idempotencyKey: "upload:tenant-1:other.md",
        rawObjectKey: `${TENANT_ID}/spaces/${SPACE_ID}/staging/other.md`,
        status: "failed-retryable",
      }),
    );
    const firstPage = await repository.list({
      knowledgeSpaceId: SPACE_ID,
      limit: 1,
      tenantId: TENANT_ID,
    });
    expect(firstPage).toEqual({
      items: [expect.objectContaining({ id: COMMIT_ID_A })],
      nextCursor: COMMIT_ID_A,
    });
    await expect(
      repository.list({
        cursor: firstPage.nextCursor,
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: COMMIT_ID_B })] });
    await expect(
      repository.list({
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        status: "failed-retryable",
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: COMMIT_ID_B })] });

    await expect(
      repository.transition({
        id: COMMIT_ID_A,
        knowledgeSpaceId: SPACE_ID,
        patch: { checksum: "a".repeat(64), sizeBytes: 4096 },
        status: "object-verified",
        tenantId: TENANT_ID,
        updatedAt: UPDATED_AT,
      }),
    ).resolves.toMatchObject({
      checksum: "a".repeat(64),
      sizeBytes: 4096,
      status: "object-verified",
      updatedAt: UPDATED_AT,
    });
    await repository.transition({
      id: COMMIT_ID_A,
      knowledgeSpaceId: SPACE_ID,
      status: "published",
      tenantId: TENANT_ID,
      updatedAt: "2026-05-27T10:10:00.000Z",
    });
    await expect(
      repository.transition({
        id: COMMIT_ID_A,
        knowledgeSpaceId: SPACE_ID,
        status: "object-staged",
        tenantId: TENANT_ID,
        updatedAt: "2026-05-27T10:15:00.000Z",
      }),
    ).rejects.toBeInstanceOf(InvalidStagedCommitTransitionError);

    const insertCalls = fake.calls.filter((call) => call.operation === "insert");
    const updateCalls = fake.calls.filter((call) => call.operation === "update");
    expect(insertCalls[0]?.sql).not.toContain(first.idempotencyKey);
    expect(insertCalls[0]?.params).toContain(first.idempotencyKey);
    expect(insertCalls[0]?.sql.includes("RETURNING *")).toBe(kind === "postgres");
    expect(updateCalls[0]?.sql.includes("RETURNING *")).toBe(kind === "postgres");
    expect(updateCalls[0]?.params.at(-1)).toBe("received");
    if (kind === "postgres") {
      expect(insertCalls[0]?.sql).toContain("ON CONFLICT");
      expect(updateCalls[0]?.sql).toContain('AND "status" = $16');
    } else {
      expect(insertCalls[0]?.sql).toContain("ON DUPLICATE KEY UPDATE");
      expect(updateCalls[0]?.sql).toContain("AND `status` = ?");
      expect(fake.calls.some((call) => call.operation === "select")).toBe(true);
    }
  });
});

function createFakeStagedCommitDatabase(kind: "postgres" | "tidb") {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });

    if (input.operation === "insert") {
      const row = stagedCommitRowFromInsert(input.params);
      const existing = Array.from(rows.values()).find(
        (candidate) =>
          candidate.tenant_id === row.tenant_id &&
          candidate.knowledge_space_id === row.knowledge_space_id &&
          candidate.idempotency_key === row.idempotency_key,
      );

      if (!existing) {
        rows.set(String(row.id), row);
      }

      return {
        rows: kind === "postgres" && !existing ? [row] : [],
        rowsAffected: existing ? 0 : 1,
      };
    }

    if (input.operation === "update") {
      const id = String(input.params[12]);
      const row = rows.get(id);
      if (
        !row ||
        row.tenant_id !== input.params[13] ||
        row.knowledge_space_id !== input.params[14] ||
        row.status !== input.params[15]
      ) {
        return { rows: [], rowsAffected: 0 };
      }

      const columns = [
        "status",
        "raw_object_key",
        "published_object_key",
        "document_asset_id",
        "parse_artifact_id",
        "projection_fingerprint",
        "checksum",
        "size_bytes",
        "error_code",
        "error_message",
        "expires_at",
        "updated_at",
      ];
      for (const [index, column] of columns.entries()) {
        row[column] = input.params[index];
      }

      return { rows: kind === "postgres" ? [{ ...row }] : [], rowsAffected: 1 };
    }

    if (input.sql.includes("idempotency_key")) {
      const row = Array.from(rows.values()).find(
        (candidate) =>
          candidate.tenant_id === input.params[0] &&
          candidate.knowledge_space_id === input.params[1] &&
          candidate.idempotency_key === input.params[2],
      );

      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.sql.includes("ORDER BY")) {
      let parameterIndex = 2;
      const statusFiltered = /["`]status["`] =/u.test(input.sql);
      const cursorFiltered = /["`]id["`] >/u.test(input.sql);
      const status = statusFiltered ? input.params[parameterIndex++] : undefined;
      const cursor = cursorFiltered ? String(input.params[parameterIndex++]) : undefined;
      const limit = Number(input.params.at(-1));
      const selected = Array.from(rows.values())
        .filter(
          (row) => row.tenant_id === input.params[0] && row.knowledge_space_id === input.params[1],
        )
        .filter((row) => status === undefined || row.status === status)
        .filter((row) => cursor === undefined || String(row.id) > cursor)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .slice(0, limit)
        .map((row) => ({ ...row }));

      return { rows: selected, rowsAffected: selected.length };
    }

    const row = rows.get(String(input.params[0]));
    const matches =
      row && row.tenant_id === input.params[1] && row.knowledge_space_id === input.params[2];

    return { rows: matches ? [{ ...row }] : [], rowsAffected: matches ? 1 : 0 };
  };

  return {
    calls,
    database: createSchemaDatabaseAdapter({ executor, kind }),
  };
}

function stagedCommitRowFromInsert(params: readonly unknown[]): Record<string, unknown> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "operation_type",
    "idempotency_key",
    "status",
    "raw_object_key",
    "published_object_key",
    "document_asset_id",
    "parse_artifact_id",
    "projection_fingerprint",
    "checksum",
    "size_bytes",
    "error_code",
    "error_message",
    "created_at",
    "updated_at",
    "expires_at",
  ];

  return Object.fromEntries(columns.map((column, index) => [column, params[index]]));
}
