import type {
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceProfileCapacityExceededError,
  createInMemoryKnowledgeSpaceProfileRepository,
} from "./knowledge-space-profile-memory-repository";
import {
  KnowledgeSpaceProfileHeadConflictError,
  KnowledgeSpaceProfileTransitionError,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3a40";
const OTHER_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3a41";
const NOW_1 = "2026-07-14T12:00:00.000Z";
const NOW_2 = "2026-07-14T12:01:00.000Z";
const NOW_3 = "2026-07-14T12:02:00.000Z";
const REVISION_IDS = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3b01",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3b02",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3b03",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3b04",
] as const;
const HEAD_IDS = [
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3c01",
  "018f0d60-7a49-7cc2-9c1b-5b36f18f3c02",
] as const;

function embeddingProfile(
  revision: number,
  dimension: number | undefined,
): KnowledgeSpaceEmbeddingProfile {
  return {
    ...(dimension === undefined ? {} : { dimension }),
    model: `embedding-model-${revision}`,
    pluginId: "embedding-plugin",
    provider: "embedding-provider",
    revision,
    vectorSpaceId: `embedding-space-sha256:${String(revision).padStart(64, "a")}`,
  };
}

function retrievalProfile(revision = 1): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "deep",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    },
    rerank: {
      enabled: true,
      model: {
        model: "rerank-model",
        pluginId: "rerank-plugin",
        provider: "rerank-provider",
      },
    },
    revision,
    scoreThreshold: { enabled: true, stage: "mode-final", value: 0.42 },
    topK: 15,
  };
}

function sequence(values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (!value) throw new Error("Test id sequence exhausted");
    index += 1;
    return value;
  };
}

function repository(options: { maxListLimit?: number; maxRevisions?: number } = {}) {
  return createInMemoryKnowledgeSpaceProfileRepository({
    generateHeadId: sequence(HEAD_IDS),
    generateRevisionId: sequence(REVISION_IDS),
    maxListLimit: options.maxListLimit ?? 10,
    maxRevisions: options.maxRevisions ?? 10,
  });
}

async function createEmbeddingCandidate(
  target: ReturnType<typeof repository>,
  input: {
    dimension?: number | undefined;
    knowledgeSpaceId?: string | undefined;
    now?: string | undefined;
    revision?: number | undefined;
    tenantId?: string | undefined;
  } = {},
) {
  const revision = input.revision ?? 1;
  return target.createCandidate({
    capabilitySnapshot: { dimensions: input.dimension ?? 3072, source: "preflight" },
    createdBySubjectId: "user:owner",
    kind: "embedding",
    knowledgeSpaceId: input.knowledgeSpaceId ?? SPACE_ID,
    now: input.now ?? NOW_1,
    snapshot: embeddingProfile(revision, input.dimension ?? 3072),
    tenantId: input.tenantId ?? "tenant-a",
  });
}

describe("in-memory knowledge-space profile repository", () => {
  it("rejects non-positive capacity and list bounds", () => {
    expect(() =>
      createInMemoryKnowledgeSpaceProfileRepository({ maxListLimit: 0, maxRevisions: 1 }),
    ).toThrow("maxListLimit");
    expect(() =>
      createInMemoryKnowledgeSpaceProfileRepository({ maxListLimit: 1, maxRevisions: 0 }),
    ).toThrow("maxRevisions");
  });

  it.each([384, 3072])(
    "persists dynamic dimension=%s and clone-isolates snapshots and capabilities",
    async (dimension) => {
      const target = repository();
      const snapshot = embeddingProfile(1, dimension);
      const capabilitySnapshot = {
        nested: { dimensions: dimension === undefined ? [] : [dimension] },
        source: "preflight",
      };
      const created = await target.createCandidate({
        capabilitySnapshot,
        createdBySubjectId: "user:owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW_1,
        snapshot,
        tenantId: "tenant-a",
      });
      const originalSnapshotDigest = knowledgeSpaceProfileSnapshotDigest(snapshot);
      const originalCapabilityDigest = knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot);

      snapshot.model = "mutated-input-model";
      capabilitySnapshot.nested.dimensions.push(999);
      (created.snapshot as KnowledgeSpaceEmbeddingProfile).model = "mutated-result-model";
      (created.capabilitySnapshot.nested as { dimensions: number[] }).dimensions.push(1000);

      const stored = await target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      });
      expect(stored).toMatchObject({
        capabilitySnapshotDigest: originalCapabilityDigest,
        model: "embedding-model-1",
        snapshotDigest: originalSnapshotDigest,
        state: "candidate",
      });
      expect(stored?.dimension).toBe(dimension);
      expect(stored?.capabilitySnapshot).toEqual({
        nested: { dimensions: dimension === undefined ? [] : [dimension] },
        source: "preflight",
      });
      expect((stored?.snapshot as KnowledgeSpaceEmbeddingProfile).model).toBe("embedding-model-1");
      expect(stored?.dimension).not.toBe(1536);
    },
  );

  it("rejects an embedding candidate without an observed model dimension", async () => {
    const target = repository();
    await expect(
      target.createCandidate({
        capabilitySnapshot: { source: "preflight" },
        createdBySubjectId: "user:owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW_1,
        snapshot: embeddingProfile(1, undefined),
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("embedding profile dimension");
  });

  it("preserves an advanced initial revision only for legacy bootstrap", async () => {
    const target = repository();
    await expect(
      target.createCandidate({
        capabilitySnapshot: { dimension: 3072, source: "preflight" },
        createdBySubjectId: "user:owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW_1,
        preserveLegacyInitialRevision: true,
        snapshot: embeddingProfile(7, 3072),
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ revision: 7, state: "candidate" });
  });

  it("isolates identical revision numbers and candidate state by tenant, space, and kind", async () => {
    const target = repository();
    await createEmbeddingCandidate(target, { tenantId: "tenant-a" });
    await createEmbeddingCandidate(target, { tenantId: "tenant-b" });
    await createEmbeddingCandidate(target, {
      knowledgeSpaceId: OTHER_SPACE_ID,
      tenantId: "tenant-a",
    });
    await target.createCandidate({
      capabilitySnapshot: { source: "preflight" },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_1,
      snapshot: retrievalProfile(),
      tenantId: "tenant-a",
    });

    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ model: "embedding-model-1", tenantId: "tenant-a" });
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.toMatchObject({ model: "embedding-model-1", tenantId: "tenant-b" });
    await expect(
      target.getRevision({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ model: "reasoning-model" });
    await expect(
      target.getRevision({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      }),
    ).resolves.not.toHaveProperty("vectorSpaceId");
    await expect(
      target.getRevision({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
  });

  it("enforces one sequential candidate per scope and preserves the first failure", async () => {
    const target = repository();
    await expect(createEmbeddingCandidate(target, { revision: 2 })).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
    });
    await createEmbeddingCandidate(target);
    await expect(createEmbeddingCandidate(target, { revision: 2 })).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS",
    });
    const failed = await target.failCandidate({
      errorCode: "PREFLIGHT_REJECTED",
      errorMessage: "dimension unsupported",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_2,
      revision: 1,
      tenantId: "tenant-a",
    });
    expect(failed).toMatchObject({
      failedAt: NOW_2,
      failureCode: "PREFLIGHT_REJECTED",
      state: "failed",
    });
    await expect(createEmbeddingCandidate(target, { revision: 3 })).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
    });
    await createEmbeddingCandidate(target, { now: NOW_3, revision: 2 });
    const replay = await target.failCandidate({
      errorCode: "DIFFERENT_ERROR",
      errorMessage: "must not overwrite",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_3,
      revision: 1,
      tenantId: "tenant-a",
    });
    expect(replay.failureCode).toBe("PREFLIGHT_REJECTED");
  });

  it("advances the head with CAS, supersedes the old revision, and rolls back stale activation", async () => {
    const target = repository();
    await createEmbeddingCandidate(target);
    const initial = await target.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_2,
      revision: 1,
      tenantId: "tenant-a",
    });
    expect(initial).toMatchObject({
      activeRevision: 1,
      profile: { activatedAt: NOW_2, state: "active" },
      rowVersion: 1,
    });
    (initial.profile.snapshot as KnowledgeSpaceEmbeddingProfile).model = "mutated-head-result";
    await expect(
      target.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ profile: { model: "embedding-model-1" } });
    await expect(
      target.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
    await createEmbeddingCandidate(target, { now: NOW_2, revision: 2 });

    const staleActivation = target.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_3,
      revision: 2,
      tenantId: "tenant-a",
    });
    await expect(staleActivation).rejects.toBeInstanceOf(KnowledgeSpaceProfileHeadConflictError);
    await expect(staleActivation).rejects.toMatchObject({
      actualActiveRevision: 1,
      expectedActiveRevision: null,
    });
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ state: "candidate" });
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: "tenant-a",
      }),
    ).resolves.not.toHaveProperty("activatedAt");
    await expect(
      target.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ activeRevision: 1, rowVersion: 1 });

    const advanced = await target.activateCandidate({
      expectedActiveRevision: 1,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_3,
      revision: 2,
      tenantId: "tenant-a",
    });
    expect(advanced).toMatchObject({
      activeRevision: 2,
      profile: { state: "active" },
      rowVersion: 2,
    });
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ state: "superseded", supersededAt: NOW_3 });
  });

  it("fails a candidate without switching the existing active head", async () => {
    const target = repository();
    await createEmbeddingCandidate(target);
    await target.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_2,
      revision: 1,
      tenantId: "tenant-a",
    });
    await createEmbeddingCandidate(target, { now: NOW_2, revision: 2 });
    await target.failCandidate({
      errorCode: "MODEL_UNAVAILABLE",
      errorMessage: "plugin daemon rejected preflight",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_3,
      revision: 2,
      tenantId: "tenant-a",
    });

    await expect(
      target.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ activeRevision: 1, profile: { state: "active" }, rowVersion: 1 });
    await expect(
      target.activateCandidate({
        expectedActiveRevision: 1,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW_3,
        revision: 2,
        tenantId: "tenant-a",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE" });
    await expect(
      target.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ activeRevision: 1, rowVersion: 1 });
  });

  it("paginates immutable history and rejects capacity overflow without partial insertion", async () => {
    const target = repository({ maxListLimit: 2, maxRevisions: 3 });
    for (const [revision, now] of [
      [1, NOW_1],
      [2, NOW_2],
      [3, NOW_3],
    ] as const) {
      await createEmbeddingCandidate(target, { now, revision });
      await target.failCandidate({
        errorCode: `FAILED_${revision}`,
        errorMessage: `failure ${revision}`,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now,
        revision,
        tenantId: "tenant-a",
      });
    }

    const first = await target.listRevisions({
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      limit: 2,
      tenantId: "tenant-a",
    });
    expect(first.items.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(first.nextRevision).toBe(2);
    const second = await target.listRevisions({
      afterRevision: first.nextRevision,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      limit: 2,
      tenantId: "tenant-a",
    });
    expect(second.items.map((revision) => revision.revision)).toEqual([3]);
    expect(second.nextRevision).toBeUndefined();
    (first.items[0]?.capabilitySnapshot as { source?: string }).source = "mutated";
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ capabilitySnapshot: { source: "preflight" } });

    await expect(
      createEmbeddingCandidate(target, {
        knowledgeSpaceId: OTHER_SPACE_ID,
        tenantId: "tenant-b",
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceProfileCapacityExceededError);
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
    await expect(
      target.listRevisions({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        limit: 3,
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("maxListLimit=2");
    await expect(
      target.listRevisions({
        afterRevision: 0,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        limit: 1,
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("afterRevision");
  });

  it("rejects generated id collisions before mutating revision or head state", async () => {
    const duplicateRevisionId = REVISION_IDS[0];
    const duplicateHeadId = HEAD_IDS[0];
    const target = createInMemoryKnowledgeSpaceProfileRepository({
      generateHeadId: () => duplicateHeadId,
      generateRevisionId: () => duplicateRevisionId,
      maxListLimit: 10,
      maxRevisions: 10,
    });
    await createEmbeddingCandidate(target, { tenantId: "tenant-a" });
    await target.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_2,
      revision: 1,
      tenantId: "tenant-a",
    });

    await expect(
      createEmbeddingCandidate(target, {
        knowledgeSpaceId: OTHER_SPACE_ID,
        tenantId: "tenant-b",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_REVISION_ID_CONFLICT" });
    await expect(
      target.getRevision({
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();

    const headCollisionTarget = createInMemoryKnowledgeSpaceProfileRepository({
      generateHeadId: () => duplicateHeadId,
      generateRevisionId: sequence(REVISION_IDS),
      maxListLimit: 10,
      maxRevisions: 10,
    });
    await createEmbeddingCandidate(headCollisionTarget, { tenantId: "tenant-a" });
    await headCollisionTarget.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_2,
      revision: 1,
      tenantId: "tenant-a",
    });
    await createEmbeddingCandidate(headCollisionTarget, {
      knowledgeSpaceId: OTHER_SPACE_ID,
      tenantId: "tenant-b",
    });
    await expect(
      headCollisionTarget.activateCandidate({
        expectedActiveRevision: null,
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        now: NOW_3,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_HEAD_ID_CONFLICT" });
    await expect(
      headCollisionTarget.getRevision({
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.toMatchObject({ state: "candidate" });
    await expect(
      headCollisionTarget.getRevision({
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        revision: 1,
        tenantId: "tenant-b",
      }),
    ).resolves.not.toHaveProperty("activatedAt");
    await expect(
      headCollisionTarget.getHead({
        kind: "embedding",
        knowledgeSpaceId: OTHER_SPACE_ID,
        tenantId: "tenant-b",
      }),
    ).resolves.toBeNull();
  });

  it("stores the complete retrieval profile while scalar routing follows the reasoning model", async () => {
    const target = repository();
    const snapshot = retrievalProfile();
    const created = await target.createCandidate({
      capabilitySnapshot: {
        reasoning: { contextWindow: 128_000 },
        rerank: { supported: true },
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW_1,
      snapshot,
      tenantId: "tenant-a",
    });

    expect(created).toMatchObject({
      model: "reasoning-model",
      pluginId: "reasoning-plugin",
      provider: "reasoning-provider",
    });
    expect(created).not.toHaveProperty("dimension");
    expect(created).not.toHaveProperty("vectorSpaceId");
    expect(created.snapshot).toEqual(snapshot);
    expect((created.snapshot as KnowledgeSpaceRetrievalProfile).rerank.model).toEqual({
      model: "rerank-model",
      pluginId: "rerank-plugin",
      provider: "rerank-provider",
    });
  });

  it("rejects non-JSON capability snapshots without consuming capacity", async () => {
    const target = repository({ maxRevisions: 1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      target.createCandidate({
        capabilitySnapshot: circular,
        createdBySubjectId: "user:owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW_1,
        snapshot: embeddingProfile(1, 3072),
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("JSON serializable");
    await expect(createEmbeddingCandidate(target)).resolves.toMatchObject({ revision: 1 });
  });
});
