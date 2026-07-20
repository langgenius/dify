import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { buildKnowledgeSpaceVectorSpaceId } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type KnowledgeSpaceProfileBackfillRunState,
  createDatabaseKnowledgeSpaceProfileBackfillRepository,
} from "./knowledge-space-profile-backfill";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import type { ModelCapabilitySnapshot } from "./model-capability-preflight";

const TENANT_ID = "tenant-backfill-test";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d40";
const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41";
const REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42";
const HEAD_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d43";
const LEASE_TOKEN = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d44";
const NOW = "2026-07-14T12:00:00.000Z";
const LEASE_EXPIRES_AT = "2026-07-14T12:05:00.000Z";

function embeddingProfile(dimension: number | undefined): KnowledgeSpaceEmbeddingProfile {
  return {
    ...(dimension === undefined ? {} : { dimension }),
    model: "legacy-user-model",
    pluginId: "legacy-plugin",
    provider: "legacy-provider",
    revision: 1,
    vectorSpaceId: `embedding-space-sha256:${"b".repeat(64)}`,
  };
}

function retrievalProfile(): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "research",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    },
    rerank: { enabled: false },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 12,
  };
}

function capability(
  kind: "embedding" | "reasoning" | "rerank",
  selection: { readonly model: string; readonly pluginId: string; readonly provider: string },
  dimension?: number,
): ModelCapabilitySnapshot {
  return {
    capabilityDigest: `sha256:${"c".repeat(64)}`,
    checkedAt: NOW,
    ...(dimension === undefined ? {} : { dimension }),
    ...(kind === "embedding" ? { distanceMetric: "cosine" as const } : {}),
    kind,
    pluginUniqueIdentifier: `installed:${selection.pluginId}`,
    schemaFingerprint: `sha256:${"d".repeat(64)}`,
    selection: { ...selection },
  };
}

async function verifiedEmbedding(
  sourceDimension: number | undefined,
  observedDimension = sourceDimension ?? 2048,
): Promise<{
  readonly capability: ModelCapabilitySnapshot;
  readonly profile: KnowledgeSpaceEmbeddingProfile;
}> {
  const selection = {
    model: "legacy-user-model",
    pluginId: "legacy-plugin",
    provider: "legacy-provider",
  };
  const verified = capability("embedding", selection, observedDimension);
  return {
    capability: verified,
    profile: {
      ...selection,
      ...(sourceDimension === undefined ? {} : { dimension: sourceDimension }),
      revision: 1,
      vectorSpaceId: await buildKnowledgeSpaceVectorSpaceId(selection, 1, {
        capabilityDigest: verified.capabilityDigest,
        dimension: observedDimension,
        distanceMetric: "cosine",
        pluginUniqueIdentifier: verified.pluginUniqueIdentifier,
        schemaFingerprint: verified.schemaFingerprint,
      }),
    },
  };
}

function backfillRow(
  sourceSnapshot: Readonly<Record<string, unknown>>,
  runState: KnowledgeSpaceProfileBackfillRunState,
): Record<string, unknown> {
  const running = runState === "running";
  const failed = runState === "failed";
  const succeeded = runState === "succeeded";
  return {
    completed_at: failed || succeeded ? NOW : null,
    created_at: NOW,
    execution_attempts: running || failed || succeeded ? 1 : 0,
    heartbeat_at: running ? NOW : null,
    id: JOB_ID,
    kind: "embedding",
    knowledge_space_id: SPACE_ID,
    last_error_code: failed ? "LEGACY_PROFILE_SOURCE_CHANGED" : null,
    last_error_message: failed ? "source changed" : null,
    lease_expires_at: running ? LEASE_EXPIRES_AT : null,
    lease_token: running ? LEASE_TOKEN : null,
    max_execution_attempts: 3,
    row_version: running ? 2 : failed || succeeded ? 3 : 1,
    run_state: runState,
    source_manifest_version: 7,
    source_snapshot: sourceSnapshot,
    source_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(sourceSnapshot),
    tenant_id: TENANT_ID,
    updated_at: NOW,
    worker_id: running ? "worker-a" : null,
  };
}

function activeSpaceResult(): DatabaseExecuteResult {
  return {
    rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
    rowsAffected: 1,
  };
}

function adapter(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
) {
  return createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
}

function repository(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
) {
  return createDatabaseKnowledgeSpaceProfileBackfillRepository({
    database: adapter(dialect, execute),
    generateHeadId: () => HEAD_ID,
    generateJobId: () => JOB_ID,
    generateLeaseToken: () => LEASE_TOKEN,
    generateRevisionId: () => REVISION_ID,
    maxClaimBatchSize: 10,
    maxDiscoveryBatchSize: 10,
    maxExecutionAttempts: 3,
  });
}

describe("knowledge-space profile backfill", () => {
  it.each(["postgres", "tidb"] as const)(
    "discovers immutable embedding and retrieval snapshots in bounded %s pages",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const embedding = embeddingProfile(4096);
      const retrieval = retrievalProfile();
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [
              {
                knowledge_space_id: SPACE_ID,
                manifest_version: 7,
                metadata: {
                  __knowledgeFsEmbeddingProfile: embedding,
                  __knowledgeFsRetrievalProfile: retrieval,
                },
                tenant_id: TENANT_ID,
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_space_profile_backfills") {
          return { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected table ${input.tableName}`);
      };

      const result = await repository(dialect, execute).discover({ limit: 5, now: NOW });

      expect(result).toEqual({
        bindingCandidates: [{ knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }],
        created: 2,
        nextKnowledgeSpaceId: SPACE_ID,
        scanned: 1,
      });
      const discovery = calls[0];
      expect(discovery?.maxRows).toBe(5);
      expect(discovery?.sql).toContain("LIMIT");
      expect(discovery?.sql).toContain("knowledge_space_profile_publication_bindings");
      expect(discovery?.sql).toContain("activated_at");
      const inserts = calls.filter((call) => call.operation === "insert");
      expect(inserts).toHaveLength(2);
      expect(inserts[0]?.params[5]).toBe(JSON.stringify(embedding));
      expect(inserts[0]?.params).not.toContain(1536);
      expect(inserts[0]?.sql).toContain(
        dialect === "postgres"
          ? 'ON CONFLICT ("tenant_id", "knowledge_space_id", "kind", "source_manifest_version", "source_snapshot_digest") DO NOTHING'
          : "INSERT IGNORE",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "claims work with lease-token and row-version fences in %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const source = embeddingProfile(768);
      let running = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.operation === "update") {
          running = true;
          return { rows: [], rowsAffected: 1 };
        }
        return {
          rows: [backfillRow(source, running ? "running" : "queued")],
          rowsAffected: 1,
        };
      };

      const claimed = await repository(dialect, execute).claim({
        leaseExpiresAt: LEASE_EXPIRES_AT,
        limit: 1,
        now: NOW,
        workerId: "worker-a",
      });

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        leaseToken: LEASE_TOKEN,
        rowVersion: 2,
        runState: "running",
      });
      expect(calls[0]?.sql.includes("SKIP LOCKED")).toBe(dialect === "postgres");
      expect(calls[1]?.params).toEqual([
        "worker-a",
        LEASE_TOKEN,
        LEASE_EXPIRES_AT,
        NOW,
        1,
        2,
        NOW,
        JOB_ID,
        1,
      ]);
    },
  );

  it("terminalizes an expired or released job that exhausted its durable attempt budget", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const source = embeddingProfile(768);
    const exhausted = {
      ...backfillRow(source, "queued"),
      execution_attempts: 3,
      row_version: 5,
    };
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      return input.operation === "select"
        ? { rows: [exhausted], rowsAffected: 1 }
        : { rows: [], rowsAffected: 1 };
    };

    await expect(
      repository("postgres", execute).claim({
        leaseExpiresAt: LEASE_EXPIRES_AT,
        limit: 1,
        now: NOW,
        workerId: "worker-a",
      }),
    ).resolves.toEqual([]);
    expect(calls[0]?.sql).not.toContain('"execution_attempts" < "max_execution_attempts"');
    expect(calls[1]).toMatchObject({
      operation: "update",
      params: [
        "PROFILE_BACKFILL_ATTEMPTS_EXHAUSTED",
        "Profile backfill exhausted its durable execution-attempt budget",
        NOW,
        6,
        JOB_ID,
        5,
      ],
    });
    expect(calls[1]?.sql).toContain("'failed'");
  });

  it("fails a stale source under the lease fence without inserting a revision or head", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const source = embeddingProfile(3072);
    let failed = false;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_manifests") {
        return {
          rows: [
            {
              manifest_version: 8,
              metadata: { __knowledgeFsEmbeddingProfile: embeddingProfile(2048) },
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_backfills") {
        if (input.operation === "update") {
          failed = true;
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [backfillRow(source, failed ? "failed" : "running")], rowsAffected: 1 };
      }
      throw new Error(`Stale source must not reach ${input.tableName}`);
    };

    const result = await repository("postgres", execute).process({
      capabilitySnapshot: capability("embedding", source, 3072),
      expectedRowVersion: 2,
      jobId: JOB_ID,
      leaseToken: LEASE_TOKEN,
      now: NOW,
    });

    expect(result).toMatchObject({ activated: false, job: { runState: "failed" } });
    expect(calls.some((call) => call.tableName === "knowledge_space_profile_revisions")).toBe(
      false,
    );
    expect(calls.some((call) => call.tableName === "knowledge_space_profile_heads")).toBe(false);
  });

  it("fails closed when the legacy vector-space identity is not proven by live capability preflight", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const source = embeddingProfile(2048);
    let failed = false;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_manifests") {
        return {
          rows: [
            {
              manifest_version: 7,
              metadata: { __knowledgeFsEmbeddingProfile: source },
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.tableName === "knowledge_space_profile_backfills") {
        if (input.operation === "update") {
          failed = true;
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [backfillRow(source, failed ? "failed" : "running")], rowsAffected: 1 };
      }
      throw new Error(`Invalid vector identity must not reach ${input.tableName}`);
    };

    const result = await repository("postgres", execute).process({
      capabilitySnapshot: capability("embedding", source, 2048),
      expectedRowVersion: 2,
      jobId: JOB_ID,
      leaseToken: LEASE_TOKEN,
      now: NOW,
    });

    expect(result).toMatchObject({
      activated: false,
      job: { runState: "failed" },
    });
    expect(
      calls.some(
        (call) => call.operation === "update" && call.params[0] === "LEGACY_PROFILE_INVALID",
      ),
    ).toBe(true);
    expect(calls.some((call) => call.tableName === "knowledge_space_profile_revisions")).toBe(
      false,
    );
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("completes idempotently when the active head matches the normalized legacy snapshot", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const verified = await verifiedEmbedding(1024);
    const normalized = verified.profile;
    const source = { ...normalized, model: ` ${normalized.model} ` };
    let succeeded = false;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_manifests") {
        return {
          rows: [
            {
              manifest_version: 7,
              metadata: { __knowledgeFsEmbeddingProfile: source },
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return {
          rows: [
            {
              active_revision: 1,
              capability_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(verified.capability),
              profile_revision_id: REVISION_ID,
              snapshot_digest: knowledgeSpaceProfileSnapshotDigest(normalized),
              state: "active",
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_backfills") {
        if (input.operation === "update") {
          succeeded = true;
          return { rows: [], rowsAffected: 1 };
        }
        return {
          rows: [backfillRow(source, succeeded ? "succeeded" : "running")],
          rowsAffected: 1,
        };
      }
      throw new Error(`Idempotent completion must not reach ${input.tableName}`);
    };

    await expect(
      repository("postgres", execute).process({
        capabilitySnapshot: verified.capability,
        expectedRowVersion: 2,
        jobId: JOB_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      activated: false,
      job: { runState: "succeeded" },
      profileRevisionId: REVISION_ID,
    });
    expect(calls.some((call) => call.tableName === "knowledge_space_profile_revisions")).toBe(
      false,
    );
    expect(calls.filter((call) => call.tableName === "knowledge_space_profile_heads")).toHaveLength(
      1,
    );
  });

  it.each([
    ["postgres", 3072, 3072],
    ["tidb", undefined, 4096],
  ] as const)(
    "atomically installs an active verified legacy profile in %s without a dimension default (%s)",
    async (dialect, sourceDimension, observedDimension) => {
      const calls: DatabaseExecuteInput[] = [];
      const verified = await verifiedEmbedding(sourceDimension, observedDimension);
      const source = verified.profile;
      let succeeded = false;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpaceResult();
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_manifests") {
          return {
            rows: [
              {
                manifest_version: 7,
                metadata: { __knowledgeFsEmbeddingProfile: source },
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_space_profile_backfills") {
          if (input.operation === "update") {
            succeeded = true;
            return { rows: [], rowsAffected: 1 };
          }
          return {
            rows: [backfillRow(source, succeeded ? "succeeded" : "running")],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_space_profile_heads") {
          return input.operation === "select"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          return input.operation === "select"
            ? { rows: [], rowsAffected: 0 }
            : { rows: [], rowsAffected: 1 };
        }
        throw new Error(`Unexpected table ${input.tableName}`);
      };

      const result = await repository(dialect, execute).process({
        capabilitySnapshot: verified.capability,
        expectedRowVersion: 2,
        jobId: JOB_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
      });

      expect(result).toMatchObject({
        activated: true,
        job: { runState: "succeeded" },
        profileRevisionId: REVISION_ID,
      });
      const revisionInsert = calls.find(
        (call) =>
          call.tableName === "knowledge_space_profile_revisions" && call.operation === "insert",
      );
      expect(revisionInsert?.params[14]).toBe(observedDimension);
      expect(revisionInsert?.params).not.toContain(1536);
      expect(JSON.parse(String(revisionInsert?.params[8]))).toEqual(verified.capability);
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_heads" && call.operation === "insert",
        ),
      ).toBe(true);
    },
  );

  it("adopts a verified v1 vector-space identity so legacy publications can enter controlled v2 migration", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const selection = {
      model: "legacy-user-model",
      pluginId: "legacy-plugin",
      provider: "legacy-provider",
    };
    const source = {
      ...selection,
      dimension: 768,
      revision: 1,
      vectorSpaceId: await buildKnowledgeSpaceVectorSpaceId(selection, 1),
    };
    const verified = capability("embedding", selection, 768);
    let succeeded = false;
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_manifests") {
        return {
          rows: [
            {
              manifest_version: 7,
              metadata: { __knowledgeFsEmbeddingProfile: source },
            },
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_backfills") {
        if (input.operation === "update") {
          succeeded = true;
          return { rows: [], rowsAffected: 1 };
        }
        return {
          rows: [backfillRow(source, succeeded ? "succeeded" : "running")],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "knowledge_space_profile_heads") {
        return input.operation === "select"
          ? { rows: [], rowsAffected: 0 }
          : { rows: [], rowsAffected: 1 };
      }
      if (input.tableName === "knowledge_space_profile_revisions") {
        return input.operation === "select"
          ? { rows: [], rowsAffected: 0 }
          : { rows: [], rowsAffected: 1 };
      }
      throw new Error(`Unexpected table ${input.tableName}`);
    };

    await expect(
      repository("postgres", execute).process({
        capabilitySnapshot: verified,
        expectedRowVersion: 2,
        jobId: JOB_ID,
        leaseToken: LEASE_TOKEN,
        now: NOW,
      }),
    ).resolves.toMatchObject({ activated: true, job: { runState: "succeeded" } });
    const revisionInsert = calls.find(
      (call) =>
        call.tableName === "knowledge_space_profile_revisions" && call.operation === "insert",
    );
    expect(JSON.parse(String(revisionInsert?.params[6]))).toMatchObject({
      dimension: 768,
      vectorSpaceId: source.vectorSpaceId,
    });
    expect(revisionInsert?.params).not.toContain(1536);
  });
});
