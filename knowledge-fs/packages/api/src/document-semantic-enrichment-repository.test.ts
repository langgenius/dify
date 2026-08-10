import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { describe, expect, it } from "vitest";

import {
  createDatabaseDocumentSemanticEnrichmentRepository,
  createInMemoryDocumentSemanticEnrichmentRepository,
  createInMemoryDocumentSemanticExtractionCheckpointRepository,
} from "./document-semantic-enrichment-repository";

const createdAt = "2026-08-09T10:00:00.000Z";
const tenantId = "tenant-1";
const knowledgeSpaceId = uuid(1);
const documentAssetId = uuid(2);
const parseArtifactId = uuid(3);
const publicationGenerationId = uuid(4);

describe("document semantic enrichment repositories", () => {
  it("reads PostgreSQL bigint base head revisions returned as strings", async () => {
    const input = jobInput(uuid(10));
    const row = {
      available_at: input.availableAt,
      base_head_revision: String(input.baseHeadRevision),
      compilation_attempt_id: input.compilationAttemptId,
      completed_at: null,
      created_at: input.createdAt,
      document_asset_id: input.documentAssetId,
      document_version: input.documentVersion,
      execution_attempts: 0,
      heartbeat_at: null,
      id: input.id,
      knowledge_space_id: input.knowledgeSpaceId,
      last_error_code: null,
      last_error_message: null,
      lease_expires_at: null,
      lease_token: null,
      max_execution_attempts: input.maxExecutionAttempts,
      parse_artifact_id: input.parseArtifactId,
      publication_generation_id: input.publicationGenerationId,
      result: {},
      retrieval_profile: input.retrievalProfile,
      row_version: 0,
      run_state: "queued",
      tenant_id: input.tenantId,
      updated_at: input.createdAt,
      worker_id: null,
    };
    const execute = async (query: { readonly operation: string }) => ({
      rows: query.operation === "select" ? [row] : [],
      rowsAffected: 1,
    });
    const repository = createDatabaseDocumentSemanticEnrichmentRepository({
      database: createSchemaDatabaseAdapter({
        executor: execute,
        kind: "postgres",
        transaction: async (callback) => callback({ execute }),
      }),
      maxClaimBatchSize: 1,
    });

    await expect(repository.enqueue(input)).resolves.toMatchObject({ baseHeadRevision: 7 });
  });

  it("admits one durable job per publication generation and fences lease mutations", async () => {
    const leaseTokens = [uuid(20), uuid(21)];
    const repository = createInMemoryDocumentSemanticEnrichmentRepository({
      generateLeaseToken: () => required(leaseTokens.shift()),
    });
    const first = await repository.enqueue(jobInput(uuid(10)));
    const replay = await repository.enqueue(jobInput(uuid(11)));

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({ executionAttempts: 0, runState: "queued" });

    const claimed = await repository.claim({
      leaseExpiresAt: "2026-08-09T10:01:00.000Z",
      limit: 1,
      now: createdAt,
      workerId: "semantic-worker-1",
    });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      executionAttempts: 1,
      leaseToken: uuid(20),
      runState: "running",
      workerId: "semantic-worker-1",
    });

    const lease = required(claimed[0]);
    await expect(
      repository.heartbeat({
        id: lease.id,
        leaseExpiresAt: "2026-08-09T10:02:00.000Z",
        leaseToken: uuid(99),
        now: "2026-08-09T10:00:30.000Z",
        workerId: "semantic-worker-1",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.release({
        id: lease.id,
        leaseToken: required(lease.leaseToken),
        now: "2026-08-09T10:00:30.000Z",
        state: "succeeded",
        workerId: "another-worker",
      }),
    ).resolves.toBeNull();

    await expect(
      repository.release({
        availableAt: "2026-08-09T10:03:00.000Z",
        id: lease.id,
        leaseToken: required(lease.leaseToken),
        now: "2026-08-09T10:00:30.000Z",
        state: "retry_wait",
        workerId: required(lease.workerId),
      }),
    ).resolves.toMatchObject({ runState: "retry_wait" });
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-08-09T10:03:30.000Z",
        limit: 1,
        now: "2026-08-09T10:02:59.000Z",
        workerId: "semantic-worker-2",
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-08-09T10:04:00.000Z",
        limit: 1,
        now: "2026-08-09T10:03:00.000Z",
        workerId: "semantic-worker-2",
      }),
    ).resolves.toMatchObject([{ executionAttempts: 2, leaseToken: uuid(21), runState: "running" }]);
  });

  it("keeps the first exact checkpoint authoritative and isolates generations", async () => {
    const repository = createInMemoryDocumentSemanticExtractionCheckpointRepository();
    const key = {
      inputFingerprint: `sha256:${"a".repeat(64)}`,
      nodeId: uuid(30),
      stage: "entity" as const,
    };
    const scope = checkpointScope(publicationGenerationId);
    const first = await repository.putMany({
      checkpoints: [{ ...key, result: { extractedEntities: [{ text: "Acme" }] } }],
      scope,
    });
    const replay = await repository.putMany({
      checkpoints: [{ ...key, result: { extractedEntities: [{ text: "Changed" }] } }],
      scope,
    });

    expect(replay).toEqual(first);
    await expect(repository.getMany({ keys: [key], scope })).resolves.toEqual(first);
    await expect(
      repository.getMany({ keys: [key], scope: checkpointScope(uuid(5)) }),
    ).resolves.toEqual([]);

    const mutable = replay[0]?.result.extractedEntities;
    if (Array.isArray(mutable)) mutable.push({ text: "Mutation" });
    await expect(repository.getMany({ keys: [key], scope })).resolves.toEqual(first);
  });
});

function jobInput(id: string) {
  return {
    availableAt: createdAt,
    baseHeadRevision: 7,
    compilationAttemptId: uuid(6),
    createdAt,
    documentAssetId,
    documentVersion: 1,
    id,
    knowledgeSpaceId,
    maxExecutionAttempts: 3,
    parseArtifactId,
    publicationGenerationId,
    retrievalProfile: {
      defaultMode: "research" as const,
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final" as const },
      topK: 10,
    },
    tenantId,
  };
}

function checkpointScope(generationId: string) {
  return {
    documentAssetId,
    documentVersion: 1,
    knowledgeSpaceId,
    publicationGenerationId: generationId,
    tenantId,
  };
}

function uuid(value: number): string {
  return `018f0d60-7a49-7cc2-9c1b-${value.toString().padStart(12, "0")}`;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected fixture value");
  return value;
}
