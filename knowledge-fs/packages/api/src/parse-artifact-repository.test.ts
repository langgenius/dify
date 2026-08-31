import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  type DatabaseRow,
  type DatabaseTransactionCallback,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createDatabaseParseArtifactRepository,
  createInMemoryParseArtifactRepository,
} from "./parse-artifact-repository";

const artifact = ParseArtifactSchema.parse({
  artifactHash: "d".repeat(64),
  contentType: "text",
  createdAt: "2026-05-09T11:00:01.000Z",
  documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
  elements: [
    {
      id: "element-1",
      metadata: { level: 1 },
      sectionPath: ["Intro"],
      text: "Hello",
      type: "paragraph",
    },
  ],
  id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
  metadata: { filename: "hello.md" },
  parser: "native-markdown",
  version: 1,
}) satisfies ParseArtifact;

describe("parse artifact repositories", () => {
  it("keeps raw parser checkpoints separate from same-version canonical artifacts", async () => {
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });
    const policyFingerprint = "a".repeat(64);
    const raw = ParseArtifactSchema.parse({
      ...artifact,
      elements: Array.from({ length: 256 }, (_, index) => ({
        id: `raw-element-${index + 1}`,
        metadata: { sourceIndex: index },
        sectionPath: ["Large parser response"],
        text: `Raw parser element ${index + 1} ${"payload ".repeat(32)}`,
        type: "paragraph" as const,
      })),
      metadata: { ...artifact.metadata, parserVersion: "native-markdown@1" },
    });

    for (const repository of [memory, database]) {
      await expect(
        repository.checkpoint({
          artifact: raw,
          policyFingerprint,
        }),
      ).resolves.toEqual({ artifact: raw, disposition: "created" });
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: raw.documentAssetId,
          version: raw.version,
        }),
      ).resolves.toBeNull();
      await expect(repository.getById({ id: raw.id })).resolves.toBeNull();
      await expect(
        repository.getCheckpoint({
          documentAssetId: raw.documentAssetId,
          version: raw.version,
        }),
      ).resolves.toEqual({
        artifact: raw,
        policyFingerprint,
      });

      const canonical = ParseArtifactSchema.parse({
        ...raw,
        elements: [
          {
            ...raw.elements[0],
            metadata: { assetRef: { objectKey: "objects/final.png" } },
          },
        ],
      });
      await expect(repository.materialize(canonical)).resolves.toEqual({
        artifact: canonical,
        disposition: "created",
      });
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: canonical.documentAssetId,
          version: canonical.version,
        }),
      ).resolves.toEqual(canonical);
      await expect(
        repository.getCheckpoint({
          documentAssetId: canonical.documentAssetId,
          version: canonical.version,
        }),
      ).resolves.toEqual({
        artifact: raw,
        policyFingerprint,
      });
      await expect(
        repository.deleteCheckpoint({
          documentAssetId: canonical.documentAssetId,
          expectedPolicyFingerprint: "b".repeat(64),
          version: canonical.version,
        }),
      ).resolves.toBe(0);
      await expect(
        repository.deleteCheckpoint({
          documentAssetId: canonical.documentAssetId,
          expectedPolicyFingerprint: policyFingerprint,
          version: canonical.version,
        }),
      ).resolves.toBe(1);
      await expect(
        repository.getCheckpoint({
          documentAssetId: canonical.documentAssetId,
          version: canonical.version,
        }),
      ).resolves.toBeNull();
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: canonical.documentAssetId,
          version: canonical.version,
        }),
      ).resolves.toEqual(canonical);
    }
  });

  it("atomically reports created, unchanged, and replaced materialization", async () => {
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });

    for (const repository of [memory, database]) {
      const materialized = ParseArtifactSchema.parse({
        ...artifact,
        elements: [
          {
            ...artifact.elements[0],
            metadata: { assetRef: { objectKey: "objects/first.png" } },
          },
        ],
      });
      await expect(repository.materialize(materialized)).resolves.toEqual({
        artifact: materialized,
        disposition: "created",
      });

      const sameHashRetry = ParseArtifactSchema.parse({
        ...materialized,
        createdAt: "2026-05-09T11:05:01.000Z",
        elements: [
          {
            ...materialized.elements[0],
            metadata: { assetRef: { objectKey: "objects/retry-must-not-win.png" } },
          },
        ],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      });
      await expect(repository.materialize(sameHashRetry)).resolves.toEqual({
        artifact: materialized,
        disposition: "unchanged",
      });

      const changedHash = ParseArtifactSchema.parse({
        ...sameHashRetry,
        artifactHash: "e".repeat(64),
        elements: [
          {
            ...sameHashRetry.elements[0],
            metadata: { assetRef: { objectKey: "objects/replacement.png" } },
          },
        ],
      });
      await expect(repository.materialize(changedHash)).resolves.toEqual({
        artifact: expect.objectContaining({
          artifactHash: changedHash.artifactHash,
          createdAt: materialized.createdAt,
          elements: [
            expect.objectContaining({
              metadata: { assetRef: { objectKey: "objects/replacement.png" } },
            }),
          ],
          id: materialized.id,
        }),
        disposition: "replaced",
      });
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: materialized.documentAssetId,
          version: materialized.version,
        }),
      ).resolves.toMatchObject({
        artifactHash: changedHash.artifactHash,
        elements: [{ metadata: { assetRef: { objectKey: "objects/replacement.png" } } }],
        id: materialized.id,
      });
    }
  });

  it("keeps generated element ids bound to the first persisted artifact on retry", async () => {
    const retryArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
    const first = ParseArtifactSchema.parse({
      ...artifact,
      elements: [
        {
          ...artifact.elements[0],
          id: `${artifact.id}:element-1`,
        },
      ],
    });
    const retry = ParseArtifactSchema.parse({
      ...first,
      createdAt: "2026-05-09T11:01:01.000Z",
      elements: [
        {
          ...first.elements[0],
          id: `${retryArtifactId}:element-1`,
        },
      ],
      id: retryArtifactId,
    });
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 2 });
    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });

    for (const repository of [memory, database]) {
      await repository.create(first);

      await expect(repository.create(retry)).resolves.toMatchObject({
        createdAt: first.createdAt,
        elements: [{ id: `${first.id}:element-1` }],
        id: first.id,
      });
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: first.documentAssetId,
          version: first.version,
        }),
      ).resolves.toMatchObject({
        elements: [{ id: `${first.id}:element-1` }],
        id: first.id,
      });
      await expect(repository.getById({ id: retryArtifactId })).resolves.toBeNull();
    }
  });

  it("does not rewrite a canonical same-hash row when the retry uses new generated ids", async () => {
    const retryArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
    const first = ParseArtifactSchema.parse({
      ...artifact,
      elements: [{ ...artifact.elements[0], id: `${artifact.id}:element-1` }],
    });
    const fake = createFakeParseArtifactExecutor({ failUpdates: true });
    const repository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });
    await repository.create(first);

    const retry = ParseArtifactSchema.parse({
      ...first,
      elements: [{ ...first.elements[0], id: `${retryArtifactId}:element-1` }],
      id: retryArtifactId,
    });

    await expect(repository.materialize(retry)).resolves.toMatchObject({
      artifact: {
        elements: [{ id: `${first.id}:element-1` }],
        id: first.id,
      },
      disposition: "unchanged",
    });
    expect(fake.calls.filter((call) => call.operation === "update")).toEqual([]);
  });

  it("stores clone-isolated artifacts and bounds in-memory capacity", async () => {
    const repository = createInMemoryParseArtifactRepository({ maxArtifacts: 1 });

    await expect(repository.create(artifact)).resolves.toEqual(artifact);
    const stored = await repository.getByDocumentVersion({
      documentAssetId: artifact.documentAssetId,
      version: artifact.version,
    });

    if (!stored) {
      throw new Error("Expected stored parse artifact");
    }

    stored.metadata.filename = "mutated.md";
    stored.elements[0]?.sectionPath.push("Mutation");

    await expect(
      repository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toMatchObject({
      elements: [{ sectionPath: ["Intro"] }],
      metadata: { filename: "hello.md" },
    });
    await expect(repository.getById({ id: artifact.id })).resolves.toMatchObject({
      id: artifact.id,
      metadata: { filename: "hello.md" },
    });
    await expect(
      repository.create({
        ...artifact,
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      }),
    ).rejects.toThrow("Parse artifact repository maxArtifacts=1 exceeded");
    expect(() => createInMemoryParseArtifactRepository({ maxArtifacts: 0 })).toThrow(
      "Parse artifact repository maxArtifacts must be at least 1",
    );
  });

  it("uses parameterized database writes and bounded deletes", async () => {
    const fake = createFakeParseArtifactExecutor();
    const repository = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });

    await expect(repository.create(artifact)).resolves.toEqual(artifact);
    await expect(
      repository.getByDocumentVersion({
        documentAssetId: artifact.documentAssetId,
        version: artifact.version,
      }),
    ).resolves.toEqual(artifact);
    await expect(repository.getById({ id: artifact.id })).resolves.toEqual(artifact);
    await expect(
      repository.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 1,
        maxArtifacts: 2,
      }),
    ).resolves.toBe(0);

    const insert = fake.calls.find((call) => call.operation === "insert");
    expect(insert).toEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "insert",
        tableName: "parse_artifacts",
      }),
    );
    expect(insert?.sql).not.toContain("hello.md");
    expect(insert?.params).toContain(JSON.stringify(artifact.elements));
    expect(insert?.params).toContain(JSON.stringify(artifact.metadata));
    expect(fake.calls[0]).toEqual(
      expect.objectContaining({
        operation: "select",
        params: [artifact.documentAssetId],
        tableName: "document_assets",
      }),
    );
    expect(fake.calls[0]?.sql).toContain("FOR UPDATE");
    expect(fake.calls[1]?.sql).toContain("FOR UPDATE");
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [artifact.documentAssetId, artifact.version],
        tableName: "parse_artifacts",
      }),
    );
    const pruneDelete = fake.calls.find(
      (call) => call.operation === "delete" && call.tableName === "parse_artifacts",
    );
    expect(pruneDelete).toEqual(
      expect.objectContaining({
        maxRows: 2,
        operation: "delete",
        params: [artifact.documentAssetId, 1],
        tableName: "parse_artifacts",
      }),
    );
    expect(pruneDelete?.sql).not.toContain(artifact.documentAssetId);
    expect(fake.calls).toContainEqual(
      expect.objectContaining({
        operation: "delete",
        tableName: "parse_artifact_checkpoints",
      }),
    );
    const checkpointPrune = fake.calls.find(
      (call) => call.operation === "delete" && call.tableName === "parse_artifact_checkpoints",
    );
    expect(checkpointPrune?.sql).toContain('FROM "parse_artifacts"');
    expect(checkpointPrune?.sql).toContain("UNION SELECT");
  });

  it("fails closed when a locked lookup resolves duplicate or mismatched artifacts", async () => {
    const row = parseArtifactRow(artifact);
    const repositoryForRows = (rows: readonly DatabaseRow[]) => {
      const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => ({
        rows:
          input.operation === "select" && input.tableName === "parse_artifacts" ? [...rows] : [],
        rowsAffected: input.operation === "insert" ? 1 : 0,
      });

      return createDatabaseParseArtifactRepository({
        database: createSchemaDatabaseAdapter({
          executor,
          kind: "tidb",
          transaction: async (callback) => callback({ execute: executor }),
        }),
      });
    };

    await expect(repositoryForRows([row, { ...row }]).materialize(artifact)).rejects.toThrow(
      "materialization resolved multiple persisted logical rows",
    );
    await expect(
      repositoryForRows([
        {
          ...row,
          document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2cff",
        },
      ]).materialize(artifact),
    ).rejects.toThrow("materialization resolved a mismatched persisted row");
  });

  it("keeps canonical retention independent from newer raw checkpoints in memory and database", async () => {
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });
    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });
    const canonicalV1 = ParseArtifactSchema.parse({
      ...artifact,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11",
      version: 1,
    });
    const checkpointV2 = ParseArtifactSchema.parse({
      ...artifact,
      artifactHash: "2".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d12",
      version: 2,
    });
    const canonicalV3 = ParseArtifactSchema.parse({
      ...artifact,
      artifactHash: "3".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d13",
      version: 3,
    });
    const checkpointV4 = ParseArtifactSchema.parse({
      ...artifact,
      artifactHash: "4".repeat(64),
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d14",
      version: 4,
    });

    for (const repository of [memory, database]) {
      await repository.materialize(canonicalV1);
      await repository.checkpoint({
        artifact: checkpointV2,
        policyFingerprint: "2".repeat(64),
      });
      await repository.materialize(canonicalV3);
      await repository.checkpoint({
        artifact: checkpointV4,
        policyFingerprint: "4".repeat(64),
      });

      await expect(
        repository.pruneDocumentVersions({
          documentAssetId: artifact.documentAssetId,
          keepVersions: 1,
          maxArtifacts: 4,
        }),
      ).resolves.toBe(1);
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: artifact.documentAssetId,
          version: canonicalV1.version,
        }),
      ).resolves.toBeNull();
      await expect(
        repository.getByDocumentVersion({
          documentAssetId: artifact.documentAssetId,
          version: canonicalV3.version,
        }),
      ).resolves.toMatchObject({ artifactHash: canonicalV3.artifactHash });
      await expect(
        repository.getCheckpoint({
          documentAssetId: artifact.documentAssetId,
          version: checkpointV2.version,
        }),
      ).resolves.toBeNull();
      await expect(
        repository.getCheckpoint({
          documentAssetId: artifact.documentAssetId,
          version: checkpointV4.version,
        }),
      ).resolves.toMatchObject({
        artifact: { artifactHash: checkpointV4.artifactHash },
        policyFingerprint: "4".repeat(64),
      });
    }
  });

  it("guards memory prune overflow and database document deletes", async () => {
    const memory = createInMemoryParseArtifactRepository({ maxArtifacts: 4 });

    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01", version: 1 });
    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02", version: 2 });
    await memory.create({ ...artifact, id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03", version: 3 });

    await expect(
      memory.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 1,
        maxArtifacts: 1,
      }),
    ).rejects.toThrow("Parse artifact prune maxArtifacts=1 exceeded");
    await expect(
      memory.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 1,
      }),
    ).rejects.toThrow("Parse artifact delete maxArtifacts=1 exceeded");

    const fake = createFakeParseArtifactExecutor();
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: fake.executor,
        kind: "postgres",
        transaction: fake.transaction,
      }),
    });

    await expect(
      database.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 0,
      }),
    ).rejects.toThrow("Parse artifact delete maxArtifacts must be at least 1");
    await expect(
      database.deleteByDocumentAsset({
        documentAssetId: artifact.documentAssetId,
        maxArtifacts: 3,
      }),
    ).resolves.toBe(0);
    const documentDelete = fake.calls.find(
      (call) => call.operation === "delete" && call.tableName === "parse_artifacts",
    );
    expect(documentDelete).toEqual(
      expect.objectContaining({
        maxRows: 3,
        operation: "delete",
        params: [artifact.documentAssetId],
        tableName: "parse_artifacts",
      }),
    );
    expect(documentDelete?.sql).not.toContain(artifact.documentAssetId);
  });

  it("surfaces raw checkpoint prune failures so retention can retry", async () => {
    let canonicalPruneCompleted = false;
    const database = createDatabaseParseArtifactRepository({
      database: createSchemaDatabaseAdapter({
        executor: async (input) => {
          if (input.operation === "delete" && input.tableName === "parse_artifacts") {
            canonicalPruneCompleted = true;
            return { rows: [], rowsAffected: 0 };
          }
          if (input.operation === "delete" && input.tableName === "parse_artifact_checkpoints") {
            throw new Error("raw checkpoint prune unavailable");
          }
          return { rows: [], rowsAffected: 0 };
        },
        kind: "postgres",
      }),
    });

    await expect(
      database.pruneDocumentVersions({
        documentAssetId: artifact.documentAssetId,
        keepVersions: 1,
        maxArtifacts: 3,
      }),
    ).rejects.toThrow("raw checkpoint prune unavailable");
    expect(canonicalPruneCompleted).toBe(true);
  });
});

function createFakeParseArtifactExecutor({
  failUpdates = false,
}: { readonly failUpdates?: boolean } = {}) {
  const calls: DatabaseExecuteInput[] = [];
  const rows = new Map<string, DatabaseRow>();
  const checkpointRows = new Map<string, DatabaseRow>();
  const executor = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({
      ...input,
      params: [...input.params],
    });

    if (input.operation === "insert" && input.tableName === "parse_artifact_checkpoints") {
      const [documentAssetId, version, policyFingerprint, artifact, createdAt, updatedAt] =
        input.params;
      const row = {
        artifact: typeof artifact === "string" ? JSON.parse(artifact) : artifact,
        created_at: String(createdAt),
        document_asset_id: String(documentAssetId),
        policy_fingerprint: String(policyFingerprint),
        updated_at: String(updatedAt),
        version: Number(version),
      } satisfies DatabaseRow;
      checkpointRows.set(`${row.document_asset_id}:${row.version}`, row);
      return { rows: [], rowsAffected: 1 };
    }

    if (input.operation === "insert") {
      const [
        id,
        documentAssetId,
        version,
        parser,
        contentType,
        artifactHash,
        elements,
        metadata,
        createdAt,
      ] = input.params;
      const row = {
        artifact_hash: String(artifactHash),
        content_type: String(contentType),
        created_at: String(createdAt),
        document_asset_id: String(documentAssetId),
        elements: typeof elements === "string" ? JSON.parse(elements) : elements,
        id: String(id),
        metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
        parser: String(parser),
        version: Number(version),
      } satisfies DatabaseRow;

      const key = `${row.document_asset_id}:${row.version}`;
      const existing = rows.get(key);
      rows.set(
        key,
        existing
          ? {
              ...row,
              created_at: existing.created_at,
              id: existing.id,
            }
          : row,
      );

      return { rows: [{ ...(rows.get(key) ?? row) }], rowsAffected: 1 };
    }

    if (input.operation === "select") {
      const [first, version] = input.params;
      if (input.tableName === "parse_artifact_checkpoints") {
        const row = checkpointRows.get(`${String(first)}:${Number(version)}`);
        return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
      }
      const row =
        input.params.length === 1
          ? Array.from(rows.values()).find((candidate) => candidate.id === String(first))
          : rows.get(`${String(first)}:${Number(version)}`);

      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.operation === "update" && input.tableName === "parse_artifact_checkpoints") {
      const [policyFingerprint, artifact, updatedAt, documentAssetId, version] = input.params;
      const key = `${String(documentAssetId)}:${Number(version)}`;
      const row = checkpointRows.get(key);
      if (!row) return { rows: [], rowsAffected: 0 };
      checkpointRows.set(key, {
        ...row,
        artifact: typeof artifact === "string" ? JSON.parse(artifact) : artifact,
        policy_fingerprint: String(policyFingerprint),
        updated_at: String(updatedAt),
      });
      return { rows: [], rowsAffected: 1 };
    }

    if (input.operation === "update") {
      if (failUpdates) {
        return { rows: [], rowsAffected: 0 };
      }

      if (input.params.length === 8) {
        const [
          parser,
          contentType,
          artifactHash,
          elements,
          metadata,
          id,
          documentAssetId,
          version,
        ] = input.params;
        const key = `${String(documentAssetId)}:${Number(version)}`;
        const row = rows.get(key);
        if (!row || row.id !== String(id)) {
          return { rows: [], rowsAffected: 0 };
        }
        rows.set(key, {
          ...row,
          artifact_hash: String(artifactHash),
          content_type: String(contentType),
          elements: typeof elements === "string" ? JSON.parse(elements) : elements,
          metadata: typeof metadata === "string" ? JSON.parse(metadata) : metadata,
          parser: String(parser),
        });

        return { rows: [], rowsAffected: 1 };
      }

      const [elements, id, documentAssetId, version] = input.params;
      const key = `${String(documentAssetId)}:${Number(version)}`;
      const row = rows.get(key);
      if (!row || row.id !== String(id)) {
        return { rows: [], rowsAffected: 0 };
      }
      rows.set(key, {
        ...row,
        elements: typeof elements === "string" ? JSON.parse(elements) : elements,
      });

      return { rows: [], rowsAffected: 1 };
    }

    if (input.operation === "delete" && input.tableName === "parse_artifact_checkpoints") {
      const [documentAssetId, version, policyFingerprint] = input.params;
      if (input.params.length === 3) {
        const key = `${String(documentAssetId)}:${Number(version)}`;
        const row = checkpointRows.get(key);
        if (!row || row.policy_fingerprint !== String(policyFingerprint)) {
          return { rows: [], rowsAffected: 0 };
        }
        checkpointRows.delete(key);
        return { rows: [], rowsAffected: 1 };
      }

      let matchingKeys = [...checkpointRows.entries()]
        .filter(([, row]) => row.document_asset_id === String(documentAssetId))
        .map(([key]) => key);
      if (input.params.length === 2) {
        const retainedVersions = new Set(
          [
            ...new Set([
              ...[...rows.values()]
                .filter((row) => row.document_asset_id === String(documentAssetId))
                .map((row) => Number(row.version)),
              ...matchingKeys.map((key) => Number(checkpointRows.get(key)?.version)),
            ]),
          ]
            .sort((left, right) => right - left)
            .slice(0, Number(version)),
        );
        matchingKeys = matchingKeys.filter(
          (key) => !retainedVersions.has(Number(checkpointRows.get(key)?.version)),
        );
      }
      for (const key of matchingKeys) checkpointRows.delete(key);
      return { rows: [], rowsAffected: matchingKeys.length };
    }

    if (input.operation === "delete" && input.tableName === "parse_artifacts") {
      const [documentAssetId, keepVersions] = input.params;
      const matching = [...rows.entries()]
        .filter(([, row]) => row.document_asset_id === String(documentAssetId))
        .sort(([, left], [, right]) => Number(right.version) - Number(left.version));
      const keysToDelete =
        input.params.length === 2
          ? matching.slice(Number(keepVersions)).map(([key]) => key)
          : matching.map(([key]) => key);
      for (const key of keysToDelete) rows.delete(key);
      return { rows: [], rowsAffected: keysToDelete.length };
    }

    return { rows: [], rowsAffected: 0 };
  };

  return {
    calls,
    executor,
    transaction: async <T>(callback: DatabaseTransactionCallback<T>) =>
      callback({ execute: executor }),
  };
}

function parseArtifactRow(input: ParseArtifact): DatabaseRow {
  return {
    artifact_hash: input.artifactHash,
    content_type: input.contentType,
    created_at: input.createdAt,
    document_asset_id: input.documentAssetId,
    elements: input.elements,
    id: input.id,
    metadata: input.metadata,
    parser: input.parser,
    version: input.version,
  };
}
