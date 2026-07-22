import { OpenAPIHono } from "@hono/zod-openapi";
import type { AnswerTrace } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import type {
  MissingEvidenceReview,
  ProductionBadCase,
  QualityControlRepository,
  QualityHistoryEvent,
  QualityReplayRun,
  QualityTrendReport,
} from "./quality-control";
import {
  QualityControlIdempotencyConflictError,
  QualityControlRevisionConflictError,
} from "./quality-control-database-repository";
import { missingEvidenceItemKey, registerQualityControlHandlers } from "./quality-control-handlers";
import { encodeQualityCursor } from "./quality-control-routes";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const OTHER_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const GOLDEN_QUESTION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const BAD_CASE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const CAPABILITY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const NOW = "2026-07-14T15:00:00.000Z";

describe("quality-control handlers", () => {
  it("passes the exact subject and server-issued candidate grants into trace history", async () => {
    const listTraces = vi.fn(async () => ({ items: [] }));
    const app = qualityApp({ listTraces } as unknown as QualityControlRepository);

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=7&mode=fast&status=failed`,
    );

    expect(response.status).toBe(200);
    expect(listTraces).toHaveBeenCalledWith({
      candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
      knowledgeSpaceId: SPACE_ID,
      limit: 7,
      mode: "fast",
      status: "failed",
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
  });

  it("binds capability trace history to the current grant principal instead of its grant id", async () => {
    const listTraces = vi.fn(
      async (_input: Parameters<QualityControlRepository["listTraces"]>[0]) => ({ items: [] }),
    );
    const app = qualityApp({ listTraces } as unknown as QualityControlRepository, {
      capabilityGrant: {
        callerKind: "workflow",
        contentScopeIds: ["tenant:tenant-1", "source:camera"],
        grantId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
        subject: "editor-1",
      },
    });

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=7&mode=fast`,
    );

    expect(response.status).toBe(200);
    expect(listTraces).toHaveBeenCalledWith({
      candidateGrants: ["tenant:tenant-1", "source:camera"],
      capabilityRequester: {
        callerKind: "workflow",
        subjectId: "editor-1",
      },
      knowledgeSpaceId: SPACE_ID,
      limit: 7,
      mode: "fast",
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
    expect(listTraces.mock.calls[0]?.[0]).not.toHaveProperty("capabilityGrantId");
  });

  it("allow-lists replay provenance/results and never returns durable authorization capabilities", async () => {
    const getReplay = vi.fn(async () => replayRun());
    const app = qualityApp({ getReplay } as unknown as QualityControlRepository);

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: RUN_ID,
      items: [
        {
          result: {
            evidenceDiff: { expectedCount: 1, missingCount: 1, retrievedCount: 1 },
            metrics: { totalMs: 17 },
            passed: false,
          },
        },
      ],
      provenance: {
        embedding: {
          dimension: 4096,
          model: "user-selected-embed",
          vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
        },
        projection: { projectionVersion: 8 },
        retrieval: { profileRevision: 5, reasoningModel: "reasoning-model" },
      },
    });
    const serialized = JSON.stringify(body);
    for (const secret of [
      "permission-secret",
      "expected-evidence-secret",
      "retrieved-evidence-secret",
      "trace-secret",
      "publication-secret",
      "arbitrary-secret",
      "raw-plan-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(body).not.toHaveProperty("tenantId");
    expect(body).not.toHaveProperty("permission");
    expect(body).not.toHaveProperty("frozenSnapshot");
  });

  it("serializes optional replay errors, results, embedding, and rerank provenance safely", async () => {
    const base = replayRun();
    const getReplay = vi
      .fn()
      .mockResolvedValueOnce({
        ...base,
        error: "PERMISSION_REVOKED",
        frozenSnapshot: {
          ...base.frozenSnapshot,
          embeddingProfile: undefined,
          retrievalProfile: {
            ...base.frozenSnapshot.retrievalProfile,
            rerank: {
              enabled: true,
              model: { model: "rerank-model", pluginId: "private-plugin", provider: "plugin" },
            },
          },
        },
        items: [
          { ...base.items[0], result: undefined },
          {
            ...base.items[0],
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99",
            result: { evidenceDiff: null, metrics: [] },
          },
        ],
      })
      .mockResolvedValueOnce({ ...base, error: undefined });
    const app = qualityApp({ getReplay } as unknown as QualityControlRepository);

    const first = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}`);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      error: "PERMISSION_REVOKED",
      items: [{ state: "failed" }, { result: { metrics: {}, passed: true } }],
      provenance: { retrieval: { rerankModel: "rerank-model" } },
    });
    const second = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}`);
    expect(await second.json()).not.toHaveProperty("error");
  });

  it("issues a fresh permission and resolves a fresh frozen snapshot on retry", async () => {
    const visible = replayRun();
    const freshSnapshot = {
      ...visible.frozenSnapshot,
      projectionSnapshot: {
        ...visible.frozenSnapshot.projectionSnapshot,
        projectionVersion: 22,
      },
    };
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 11,
    }));
    const retryReplay = vi.fn(async () => ({ ...visible, state: "queued" as const }));
    const resolve = vi.fn(async () => freshSnapshot);
    const assertReady = vi.fn(async () => undefined);
    const app = qualityApp(
      {
        getReplay: vi.fn(async () => visible),
        retryReplay,
      } as unknown as QualityControlRepository,
      {
        access: { createPermissionSnapshot } as never,
        runtimeSnapshots: { assertReady, resolve },
      },
    );

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/retry`,
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(202);
    expect(createPermissionSnapshot).toHaveBeenCalledWith({
      accessChannel: "interactive",
      expiresAt: "2026-07-15T15:00:00.000Z",
      knowledgeSpaceId: SPACE_ID,
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
    expect(resolve).toHaveBeenCalledWith({
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId: SPACE_ID,
      resolvedMode: "fast",
      tenantId: "tenant-1",
    });
    expect(retryReplay).toHaveBeenCalledWith({
      actorSubjectId: "editor-1",
      expectedRevision: 2,
      frozenSnapshot: freshSnapshot,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      permission: {
        accessChannel: "interactive",
        candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60",
        permissionSnapshotRevision: 11,
        requestedBySubjectId: "editor-1",
      },
      tenantId: "tenant-1",
    });
  });

  it("issues a fresh permission for cancellation instead of trusting request middleware scope", async () => {
    const visible = replayRun();
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
      permissionScopes: ["knowledge-space:current", "tenant:tenant-1"],
      revision: 12,
    }));
    const cancelReplay = vi.fn(async () => ({ ...visible, state: "canceled" as const }));
    const app = qualityApp(
      {
        cancelReplay,
        getReplay: vi.fn(async () => visible),
      } as unknown as QualityControlRepository,
      { access: { createPermissionSnapshot } as never },
    );

    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/cancel`,
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(cancelReplay).toHaveBeenCalledWith({
      actorSubjectId: "editor-1",
      expectedRevision: 2,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      permission: {
        accessChannel: "interactive",
        candidateGrants: ["knowledge-space:current", "tenant:tenant-1"],
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
        permissionSnapshotRevision: 12,
        requestedBySubjectId: "editor-1",
      },
      tenantId: "tenant-1",
    });
  });

  it("uses only the admitted capability locator for replay create, visibility and cancel", async () => {
    const createPermissionSnapshot = vi.fn(async () => {
      throw new Error("legacy permission issuance must not run");
    });
    const frozen = replayRun().frozenSnapshot;
    const capabilityRun = {
      ...replayRun(),
      capabilityGrantId: CAPABILITY_GRANT_ID,
      permission: undefined,
    };
    const createReplay = vi.fn(
      async (_input: Parameters<QualityControlRepository["createReplay"]>[0]) => capabilityRun,
    );
    const getReplay = vi.fn(async () => capabilityRun);
    const cancelReplay = vi.fn(async () => ({ ...capabilityRun, state: "canceled" as const }));
    const listReplays = vi.fn(async () => ({ items: [capabilityRun] }));
    const retryReplay = vi.fn(async () => ({ ...capabilityRun, state: "queued" as const }));
    const app = qualityApp(
      {
        cancelReplay,
        createReplay,
        getReplay,
        listReplays,
        retryReplay,
      } as unknown as QualityControlRepository,
      {
        access: { createPermissionSnapshot } as never,
        capabilityGrant: {
          contentScopeIds: ["tenant:tenant-1", "source:camera"],
          grantId: CAPABILITY_GRANT_ID,
        },
        goldenQuestions: {
          get: vi.fn(async () => ({
            createdAt: NOW,
            expectedEvidenceIds: [],
            id: GOLDEN_QUESTION_ID,
            knowledgeSpaceId: SPACE_ID,
            metadata: {},
            question: "Which camera evidence is missing?",
            tags: [],
            updatedAt: NOW,
          })),
        } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => frozen),
        },
      },
    );

    const created = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs`, {
      body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID] }),
      headers: { "content-type": "application/json", "idempotency-key": "capability-replay" },
      method: "POST",
    });
    expect(created.status).toBe(202);
    expect(createReplay).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );
    expect(createReplay.mock.calls[0]?.[0]).not.toHaveProperty("permission");

    const canceled = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/cancel`,
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(canceled.status).toBe(200);
    expect(getReplay).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );
    expect(cancelReplay).toHaveBeenCalledWith({
      actorSubjectId: "editor-1",
      capabilityGrantId: CAPABILITY_GRANT_ID,
      expectedRevision: 2,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });

    const status = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}`);
    expect(status.status).toBe(200);
    const list = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs?limit=10`);
    expect(list.status).toBe(200);
    const retried = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/retry`,
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(retried.status).toBe(202);
    expect(listReplays).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );
    expect(retryReplay).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );
    expect(createPermissionSnapshot).not.toHaveBeenCalled();
  });

  it("fails request scope closed for a mismatched API-key binding or absent grants", async () => {
    const repository = {
      listTraces: vi.fn(async () => ({ items: [] })),
    } as unknown as QualityControlRepository;
    const mismatchedKey = qualityApp(repository, {
      authenticatedApiKeyKnowledgeSpaceId: OTHER_SPACE_ID,
      callerKind: "api_key",
    });
    expect(
      (await mismatchedKey.request(`/knowledge-spaces/${SPACE_ID}/quality/traces?limit=10`)).status,
    ).toBe(404);

    const noGrants = qualityApp(repository, { authorizationDecision: null });
    expect(
      (await noGrants.request(`/knowledge-spaces/${SPACE_ID}/quality/traces?limit=10`)).status,
    ).toBe(404);
  });

  it("rejects absent and candidate-hidden golden-question evidence", async () => {
    const requestReplay = (overrides: Parameters<typeof qualityApp>[1]) =>
      qualityApp({ createReplay: vi.fn() } as unknown as QualityControlRepository, {
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => replayRun().frozenSnapshot),
        },
        ...overrides,
      }).request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs`, {
        body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID] }),
        headers: { "content-type": "application/json", "idempotency-key": "hidden-question" },
        method: "POST",
      });
    const question = {
      createdAt: NOW,
      expectedEvidenceIds: ["evidence-1"],
      id: GOLDEN_QUESTION_ID,
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      question: "Which evidence?",
      tags: [],
      updatedAt: NOW,
    };

    expect(
      (await requestReplay({ goldenQuestions: { get: vi.fn(async () => null) } as never })).status,
    ).toBe(404);
    expect(
      (
        await requestReplay({
          goldenQuestions: { get: vi.fn(async () => question) } as never,
          nodes: {
            getMany: vi.fn(async () => [
              { documentAssetId: "asset-1", id: "evidence-1", permissionScope: ["private"] },
            ]),
          } as never,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await requestReplay({
          assets: {
            get: vi.fn(async () => ({ metadata: { permissionScope: ["private"] } })),
          } as never,
          goldenQuestions: { get: vi.fn(async () => question) } as never,
          nodes: { getMany: vi.fn(async () => []) } as never,
        })
      ).status,
    ).toBe(404);
  });

  it("serves the authorized bad-case, replay-history, and trend lifecycle", async () => {
    const currentBadCase = badCase();
    const listBadCases = vi.fn(async () => ({
      items: [currentBadCase],
      nextCursor: { createdAt: NOW, id: BAD_CASE_ID },
    }));
    const getBadCase = vi.fn(async () => currentBadCase);
    const updateBadCase = vi.fn(async () => ({
      ...currentBadCase,
      revision: 2,
      status: "fixed" as const,
      tags: ["regression", "fixed"],
    }));
    const listHistory = vi.fn(async () => [historyEvent()]);
    const listReplays = vi.fn(async () => ({
      items: [replayRun()],
      nextCursor: { createdAt: NOW, id: RUN_ID },
    }));
    const trends = vi.fn(async () => trendReport());
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 13,
    }));
    const app = qualityApp(
      {
        getBadCase,
        listBadCases,
        listHistory,
        listReplays,
        trends,
        updateBadCase,
      } as unknown as QualityControlRepository,
      { access: { createPermissionSnapshot } as never },
    );

    const list = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases?limit=1&status=open`,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [{ id: BAD_CASE_ID, status: "open" }],
      nextCursor: expect.any(String),
    });

    const get = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`);
    expect(get.status).toBe(200);
    expect(JSON.stringify(await get.json())).not.toContain("trace-capability-secret");

    const update = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      {
        body: JSON.stringify({
          expectedRevision: 1,
          status: "fixed",
          tags: ["regression", "fixed"],
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(update.status).toBe(200);
    expect(updateBadCase).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 1,
        id: BAD_CASE_ID,
        permission: expect.objectContaining({ permissionSnapshotRevision: 13 }),
        status: "fixed",
      }),
    );

    const history = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}/history`,
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ items: [historyEvent()] });

    const replays = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs?limit=1&mode=fast&state=failed`,
    );
    expect(replays.status).toBe(200);
    expect(await replays.json()).toMatchObject({
      items: [{ id: RUN_ID, state: "failed" }],
      nextCursor: expect.any(String),
    });

    const trendsResponse = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/trends?window=7d`,
    );
    expect(trendsResponse.status).toBe(200);
    expect(await trendsResponse.json()).toEqual(trendReport());
    expect(trends).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "2026-07-07T15:00:00.000Z",
        to: NOW,
        topLimit: 20,
      }),
    );
  });

  it("creates a replay only from unique visible questions and a frozen ready snapshot", async () => {
    const frozen = replayRun().frozenSnapshot;
    const createReplay = vi.fn(async (input) => ({
      ...replayRun(),
      error: undefined,
      frozenSnapshot: input.frozenSnapshot,
      mode: input.mode,
      state: "queued" as const,
    }));
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c63",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 14,
    }));
    const resolve = vi.fn(async () => frozen);
    const assertReady = vi.fn(async () => undefined);
    const getQuestion = vi.fn(async () => ({
      createdAt: NOW,
      expectedEvidenceIds: [],
      id: GOLDEN_QUESTION_ID,
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      question: "Which camera evidence is missing?",
      tags: ["regression"],
      updatedAt: NOW,
    }));
    const app = qualityApp({ createReplay } as unknown as QualityControlRepository, {
      access: { createPermissionSnapshot } as never,
      assets: { get: vi.fn(async () => null) } as never,
      goldenQuestions: { get: getQuestion } as never,
      nodes: { getMany: vi.fn(async () => []) } as never,
      runtimeSnapshots: { assertReady, resolve },
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs`, {
      body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID], mode: "fast" }),
      headers: { "content-type": "application/json", "idempotency-key": "replay-request-1" },
      method: "POST",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    expect(createReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "replay-request-1",
        mode: "fast",
        questions: [
          {
            expectedEvidenceIds: [],
            id: GOLDEN_QUESTION_ID,
            question: "Which camera evidence is missing?",
          },
        ],
        requestFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      }),
    );
    expect(resolve).toHaveBeenCalledOnce();
    expect(assertReady).toHaveBeenCalledWith(expect.objectContaining({ resolvedMode: "fast" }));

    const duplicate = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/replay-runs`, {
      body: JSON.stringify({
        goldenQuestionIds: [GOLDEN_QUESTION_ID, GOLDEN_QUESTION_ID],
        mode: "fast",
      }),
      headers: { "content-type": "application/json", "idempotency-key": "replay-request-2" },
      method: "POST",
    });
    expect(duplicate.status).toBe(404);
    expect(createReplay).toHaveBeenCalledTimes(1);
  });

  it("reviews visible missing evidence and captures its subject-owned trace as a bad case", async () => {
    const trace = visibleTrace();
    const missing = {
      metadata: { source: "camera" },
      reason: "not-retrieved" as const,
      text: "Camera evidence was expected",
    };
    const itemKey = missingEvidenceItemKey(missing);
    const review: MissingEvidenceReview = {
      actorSubjectId: "editor-1",
      createdAt: NOW,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
      itemKey,
      knowledgeSpaceId: SPACE_ID,
      reason: "Verified omission",
      revision: 1,
      status: "active",
      traceId: TRACE_ID,
      updatedAt: NOW,
    };
    const upsertMissingReview = vi.fn(async () => review);
    const getMissingReview = vi.fn(async () => review);
    const listHistory = vi.fn(async () => [historyEvent()]);
    const createBadCase = vi.fn(async () => badCase());
    const revalidatePermissionSnapshot = vi.fn(async () => ({ revision: 1 }));
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c64",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 15,
    }));
    const app = qualityApp(
      {
        createBadCase,
        getMissingReview,
        listHistory,
        upsertMissingReview,
      } as unknown as QualityControlRepository,
      {
        access: { createPermissionSnapshot, revalidatePermissionSnapshot } as never,
        answerTraces: { get: vi.fn(async () => trace) } as never,
        assets: { get: vi.fn(async () => null) } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
      },
    );

    const reviewed = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}`,
      {
        body: JSON.stringify({
          expectedRevision: 0,
          reason: "Verified omission",
          status: "active",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(reviewed.status, await reviewed.clone().text()).toBe(200);
    expect(upsertMissingReview).toHaveBeenCalledWith(
      expect.objectContaining({
        itemKey,
        permission: expect.objectContaining({ permissionSnapshotRevision: 15 }),
        traceId: TRACE_ID,
      }),
    );

    const history = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}/history`,
    );
    expect(history.status).toBe(200);
    expect(getMissingReview).toHaveBeenCalledWith(expect.objectContaining({ itemKey }));

    const created = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/bad-cases`, {
      body: JSON.stringify({ reason: "Regression", tags: ["camera"], traceId: TRACE_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect(createBadCase).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "Regression", tags: ["camera"], traceId: TRACE_ID }),
    );
    expect(revalidatePermissionSnapshot).toHaveBeenCalledTimes(3);
  });

  it("fails every quality endpoint closed for a missing space or unavailable runtime", async () => {
    const itemKey = `sha256:${"a".repeat(64)}`;
    const jsonHeaders = { "content-type": "application/json" };
    const routes: readonly { readonly init?: RequestInit; readonly path: string }[] = [
      { path: `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=10` },
      {
        init: {
          body: JSON.stringify({ expectedRevision: 0, status: "active" }),
          headers: jsonHeaders,
          method: "PATCH",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}`,
      },
      {
        path: `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}/history`,
      },
      {
        init: {
          body: JSON.stringify({ reason: "Regression", traceId: TRACE_ID }),
          headers: jsonHeaders,
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases`,
      },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases?limit=10` },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}` },
      {
        init: {
          body: JSON.stringify({ expectedRevision: 1, status: "fixed" }),
          headers: jsonHeaders,
          method: "PATCH",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}/history` },
      {
        init: {
          body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID] }),
          headers: { ...jsonHeaders, "idempotency-key": "missing-runtime-replay" },
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs`,
      },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}` },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs?limit=10` },
      {
        init: {
          body: JSON.stringify({ expectedRevision: 1 }),
          headers: jsonHeaders,
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/cancel`,
      },
      {
        init: {
          body: JSON.stringify({ expectedRevision: 1 }),
          headers: jsonHeaders,
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/retry`,
      },
      { path: `/knowledge-spaces/${SPACE_ID}/quality/trends?window=24h` },
    ];
    const app = qualityApp(undefined);

    for (const route of routes) {
      const missingSpace = await app.request(
        route.path.replace(SPACE_ID, OTHER_SPACE_ID),
        route.init,
      );
      expect(missingSpace.status, route.path).toBe(404);
      expect(await missingSpace.json()).toEqual({ error: "Knowledge space not found" });

      const unavailable = await app.request(route.path, route.init);
      expect(unavailable.status, route.path).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "Quality runtime unavailable" });
    }
  });

  it("forwards every list cursor/filter and derives each supported trend window", async () => {
    const cursor = encodeQualityCursor({ createdAt: NOW, id: RUN_ID });
    const listTraces = vi.fn(async () => ({ items: [] }));
    const listBadCases = vi.fn(async () => ({ items: [] }));
    const listReplays = vi.fn(async () => ({ items: [] }));
    const trends = vi.fn(async (input) => ({ ...trendReport(), from: input.from, to: input.to }));
    const app = qualityApp({
      listBadCases,
      listReplays,
      listTraces,
      trends,
    } as unknown as QualityControlRepository);

    const traceResponse = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=2&cursor=${encodeURIComponent(cursor)}&from=2026-07-01T00%3A00%3A00.000Z&to=${encodeURIComponent(NOW)}&query=camera&mode=fast&status=failed`,
    );
    expect(traceResponse.status).toBe(200);
    expect(await traceResponse.json()).toEqual({ items: [] });
    expect(listTraces).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { createdAt: NOW, id: RUN_ID },
        from: "2026-07-01T00:00:00.000Z",
        query: "camera",
        to: NOW,
      }),
    );

    await app.request(`/knowledge-spaces/${SPACE_ID}/quality/traces?limit=2`);
    expect(listTraces).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ cursor: expect.anything(), mode: expect.anything() }),
    );

    const badCasesResponse = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases?limit=2&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(badCasesResponse.status).toBe(200);
    expect(await badCasesResponse.json()).toEqual({ items: [] });
    expect(listBadCases).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { createdAt: NOW, id: RUN_ID } }),
    );

    const replayResponse = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs?limit=2&cursor=${encodeURIComponent(cursor)}&from=2026-07-01T00%3A00%3A00.000Z&to=${encodeURIComponent(NOW)}`,
    );
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toEqual({ items: [] });
    expect(listReplays).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { createdAt: NOW, id: RUN_ID },
        from: "2026-07-01T00:00:00.000Z",
        to: NOW,
      }),
    );

    for (const [window, expectedFrom] of [
      ["24h", "2026-07-13T15:00:00.000Z"],
      ["30d", "2026-06-14T15:00:00.000Z"],
    ] as const) {
      const response = await app.request(
        `/knowledge-spaces/${SPACE_ID}/quality/trends?window=${window}`,
      );
      expect(response.status).toBe(200);
      expect(trends).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: expectedFrom, to: NOW }),
      );
    }

    const explicitTrend = await app.request(
      `/knowledge-spaces/${SPACE_ID}/quality/trends?window=7d&from=2026-07-10T00%3A00%3A00.000Z&to=2026-07-11T00%3A00%3A00.000Z`,
    );
    expect(explicitTrend.status).toBe(200);
    expect(trends).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: "2026-07-10T00:00:00.000Z",
        to: "2026-07-11T00:00:00.000Z",
      }),
    );
  });

  it("returns resource-scoped not-found responses after visibility and mutation rechecks", async () => {
    const trace = visibleTrace();
    const missing = {
      metadata: { source: "camera" },
      reason: "not-retrieved" as const,
      text: "Camera evidence was expected",
    };
    const itemKey = missingEvidenceItemKey(missing);
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c70",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 20,
    }));
    const access = {
      createPermissionSnapshot,
      revalidatePermissionSnapshot: vi.fn(async () => ({ revision: 1 })),
    } as never;
    const traceApp = qualityApp(
      {
        createBadCase: vi.fn(async () => badCase()),
        getMissingReview: vi.fn(async () => null),
        listHistory: vi.fn(async () => []),
        upsertMissingReview: vi.fn(async () => null),
      } as unknown as QualityControlRepository,
      {
        access,
        answerTraces: { get: vi.fn(async () => trace) } as never,
        assets: { get: vi.fn(async () => null) } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
      },
    );

    const wrongReview = await traceApp.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/sha256:${"b".repeat(64)}`,
      {
        body: JSON.stringify({ expectedRevision: 0, status: "active" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(wrongReview.status).toBe(404);

    const disappearedReview = await traceApp.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}`,
      {
        body: JSON.stringify({ expectedRevision: 0, status: "active" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(disappearedReview.status).toBe(404);

    for (const historyKey of [`sha256:${"b".repeat(64)}`, itemKey]) {
      const response = await traceApp.request(
        `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${historyKey}/history`,
      );
      expect(response.status).toBe(404);
    }

    const createdWithoutTags = await traceApp.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases`,
      {
        body: JSON.stringify({ reason: "Regression", traceId: TRACE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(createdWithoutTags.status).toBe(201);

    const hiddenTraceApp = qualityApp(
      { createBadCase: vi.fn() } as unknown as QualityControlRepository,
      { answerTraces: { get: vi.fn(async () => null) } as never },
    );
    const hiddenTrace = await hiddenTraceApp.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases`,
      {
        body: JSON.stringify({ reason: "Regression", traceId: TRACE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(hiddenTrace.status).toBe(404);

    const missingResources = qualityApp(
      {
        getBadCase: vi.fn(async () => null),
        getReplay: vi.fn(async () => null),
      } as unknown as QualityControlRepository,
      {
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => replayRun().frozenSnapshot),
        },
      },
    );
    for (const route of [
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}/history`,
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}`,
    ]) {
      const response = await missingResources.request(route);
      expect(response.status, route).toBe(404);
    }
    const missingBadCaseUpdate = await missingResources.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      {
        body: JSON.stringify({ expectedRevision: 1, status: "fixed" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(missingBadCaseUpdate.status).toBe(404);
    for (const action of ["cancel", "retry"] as const) {
      const response = await missingResources.request(
        `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/${action}`,
        {
          body: JSON.stringify({ expectedRevision: 1 }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(response.status, action).toBe(404);
    }

    const nullableMutations = qualityApp(
      {
        cancelReplay: vi.fn(async () => null),
        getBadCase: vi.fn(async () => badCase()),
        getReplay: vi.fn(async () => replayRun()),
        retryReplay: vi.fn(async () => null),
        updateBadCase: vi.fn(async () => null),
      } as unknown as QualityControlRepository,
      {
        access,
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => replayRun().frozenSnapshot),
        },
      },
    );
    const fullUpdate = await nullableMutations.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      {
        body: JSON.stringify({
          expectedRevision: 1,
          reason: "Reclassified",
          replayRunId: RUN_ID,
          status: "replaying",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(fullUpdate.status).toBe(404);
    const updateWithoutTags = await nullableMutations.request(
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      {
        body: JSON.stringify({ expectedRevision: 1, status: "fixed" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    expect(updateWithoutTags.status).toBe(404);
    for (const action of ["cancel", "retry"] as const) {
      const response = await nullableMutations.request(
        `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/${action}`,
        {
          body: JSON.stringify({ expectedRevision: 2 }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(response.status, action).toBe(404);
    }
  });

  it("maps repository read and mutation failures without exposing internal errors", async () => {
    const nextCursorApp = qualityApp({
      listTraces: vi.fn(async () => ({
        items: [],
        nextCursor: { createdAt: NOW, id: TRACE_ID },
      })),
    } as unknown as QualityControlRepository);
    const cursorResponse = await nextCursorApp.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=1`,
    );
    expect(cursorResponse.status).toBe(200);
    expect(await cursorResponse.json()).toMatchObject({ nextCursor: expect.any(String) });

    const readFailure = new Error("database host and secret must stay private");
    const rejectingReads = qualityApp({
      listBadCases: vi.fn(async () => {
        throw readFailure;
      }),
      listReplays: vi.fn(async () => {
        throw readFailure;
      }),
      listTraces: vi.fn(async () => {
        throw readFailure;
      }),
      trends: vi.fn(async () => {
        throw readFailure;
      }),
    } as unknown as QualityControlRepository);
    for (const route of [
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=1`,
      `/knowledge-spaces/${SPACE_ID}/quality/bad-cases?limit=1`,
      `/knowledge-spaces/${SPACE_ID}/quality/replay-runs?limit=1`,
      `/knowledge-spaces/${SPACE_ID}/quality/trends?window=7d`,
    ]) {
      const response = await rejectingReads.request(route);
      expect(response.status, route).toBe(400);
      expect(await response.json()).toEqual({ error: "Quality operation failed" });
    }

    const mutationFailure = new Error("durable mutation failed with private details");
    const rejectMutation = vi.fn(async () => {
      throw mutationFailure;
    });
    const trace = visibleTrace();
    const missing = {
      metadata: { source: "camera" },
      reason: "not-retrieved" as const,
      text: "Camera evidence was expected",
    };
    const itemKey = missingEvidenceItemKey(missing);
    const createPermissionSnapshot = vi.fn(async () => ({
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c71",
      permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
      revision: 21,
    }));
    const frozen = replayRun().frozenSnapshot;
    const rejectingMutations = qualityApp(
      {
        cancelReplay: rejectMutation,
        createBadCase: rejectMutation,
        createReplay: rejectMutation,
        getBadCase: vi.fn(async () => badCase()),
        getReplay: vi.fn(async () => replayRun()),
        retryReplay: rejectMutation,
        updateBadCase: rejectMutation,
        upsertMissingReview: rejectMutation,
      } as unknown as QualityControlRepository,
      {
        access: {
          createPermissionSnapshot,
          revalidatePermissionSnapshot: vi.fn(async () => ({ revision: 1 })),
        } as never,
        answerTraces: { get: vi.fn(async () => trace) } as never,
        assets: { get: vi.fn(async () => null) } as never,
        goldenQuestions: {
          get: vi.fn(async () => ({
            createdAt: NOW,
            expectedEvidenceIds: [],
            id: GOLDEN_QUESTION_ID,
            knowledgeSpaceId: SPACE_ID,
            metadata: {},
            question: "Which camera evidence is missing?",
            tags: [],
            updatedAt: NOW,
          })),
        } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => frozen),
        },
      },
    );
    const mutationRequests: readonly {
      readonly expectedStatus: number;
      readonly init: RequestInit;
      readonly path: string;
    }[] = [
      {
        expectedStatus: 503,
        init: {
          body: JSON.stringify({ expectedRevision: 0, status: "active" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}`,
      },
      {
        expectedStatus: 503,
        init: {
          body: JSON.stringify({ reason: "Regression", traceId: TRACE_ID }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases`,
      },
      {
        expectedStatus: 503,
        init: {
          body: JSON.stringify({ expectedRevision: 1, status: "fixed" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
      },
      {
        expectedStatus: 503,
        init: {
          body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID] }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": "rejecting-replay",
          },
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs`,
      },
      ...(["cancel", "retry"] as const).map((action) => ({
        expectedStatus: 503,
        init: {
          body: JSON.stringify({ expectedRevision: 2 }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/${action}`,
      })),
    ];
    for (const request of mutationRequests) {
      const response = await rejectingMutations.request(request.path, request.init);
      expect(response.status, request.path).toBe(request.expectedStatus);
      expect(await response.json()).toEqual({ error: "Quality operation failed" });
    }
  });

  it("maps revision, idempotency, and permission races to stable public statuses", async () => {
    const revisionError = new QualityControlRevisionConflictError();
    const idempotencyError = new QualityControlIdempotencyConflictError();
    const permissionError = new KnowledgeSpaceAccessError(
      "space_access_permission_snapshot_invalid",
      "revoked permission details",
    );
    const rejectWith = (error: Error) =>
      vi.fn(async () => {
        throw error;
      });
    const itemKey = missingEvidenceItemKey({
      metadata: { source: "camera" },
      reason: "not-retrieved",
      text: "Camera evidence was expected",
    });
    const frozen = replayRun().frozenSnapshot;
    const jsonHeaders = { "content-type": "application/json" };
    const cases: readonly {
      readonly expectedStatus: number;
      readonly init: RequestInit;
      readonly label: string;
      readonly path: string;
      readonly repository: Partial<QualityControlRepository>;
    }[] = [
      ...([revisionError, permissionError] as const).map((error) => ({
        expectedStatus: error === revisionError ? 409 : 403,
        init: {
          body: JSON.stringify({ expectedRevision: 0, status: "active" }),
          headers: jsonHeaders,
          method: "PATCH",
        },
        label: `review ${error.name}`,
        path: `/knowledge-spaces/${SPACE_ID}/quality/traces/${TRACE_ID}/missing/${itemKey}`,
        repository: { upsertMissingReview: rejectWith(error) },
      })),
      {
        expectedStatus: 403,
        init: {
          body: JSON.stringify({ reason: "Regression", traceId: TRACE_ID }),
          headers: jsonHeaders,
          method: "POST",
        },
        label: "create bad case permission race",
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases`,
        repository: { createBadCase: rejectWith(permissionError) },
      },
      ...([revisionError, permissionError] as const).map((error) => ({
        expectedStatus: error === revisionError ? 409 : 403,
        init: {
          body: JSON.stringify({ expectedRevision: 1, status: "fixed" }),
          headers: jsonHeaders,
          method: "PATCH",
        },
        label: `update bad case ${error.name}`,
        path: `/knowledge-spaces/${SPACE_ID}/quality/bad-cases/${BAD_CASE_ID}`,
        repository: {
          getBadCase: vi.fn(async () => badCase()),
          updateBadCase: rejectWith(error),
        },
      })),
      ...([idempotencyError, permissionError] as const).map((error) => ({
        expectedStatus: error === idempotencyError ? 409 : 403,
        init: {
          body: JSON.stringify({ goldenQuestionIds: [GOLDEN_QUESTION_ID] }),
          headers: { ...jsonHeaders, "idempotency-key": `race-${error.name}` },
          method: "POST",
        },
        label: `create replay ${error.name}`,
        path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs`,
        repository: { createReplay: rejectWith(error) },
      })),
      ...(["cancel", "retry"] as const).flatMap((action) =>
        ([revisionError, permissionError] as const).map((error) => ({
          expectedStatus: error === revisionError ? 409 : 403,
          init: {
            body: JSON.stringify({ expectedRevision: 2 }),
            headers: jsonHeaders,
            method: "POST",
          },
          label: `${action} replay ${error.name}`,
          path: `/knowledge-spaces/${SPACE_ID}/quality/replay-runs/${RUN_ID}/${action}`,
          repository: {
            [action === "cancel" ? "cancelReplay" : "retryReplay"]: rejectWith(error),
            getReplay: vi.fn(async () => replayRun()),
          },
        })),
      ),
    ];

    for (const scenario of cases) {
      const app = qualityApp(scenario.repository as QualityControlRepository, {
        access: {
          createPermissionSnapshot: vi.fn(async () => ({
            accessChannel: "interactive",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c72",
            permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
            revision: 22,
          })),
          revalidatePermissionSnapshot: vi.fn(async () => ({ revision: 1 })),
        } as never,
        answerTraces: { get: vi.fn(async () => visibleTrace()) } as never,
        assets: { get: vi.fn(async () => null) } as never,
        goldenQuestions: {
          get: vi.fn(async () => ({
            createdAt: NOW,
            expectedEvidenceIds: [],
            id: GOLDEN_QUESTION_ID,
            knowledgeSpaceId: SPACE_ID,
            metadata: {},
            question: "Which camera evidence is missing?",
            tags: [],
            updatedAt: NOW,
          })),
        } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
        runtimeSnapshots: {
          assertReady: vi.fn(async () => undefined),
          resolve: vi.fn(async () => frozen),
        },
      });
      const response = await app.request(scenario.path, scenario.init);
      expect(response.status, scenario.label).toBe(scenario.expectedStatus);
      expect(JSON.stringify(await response.json()), scenario.label).not.toContain(
        "revoked permission details",
      );
    }

    const listConflict = qualityApp({
      listTraces: rejectWith(revisionError),
    } as unknown as QualityControlRepository);
    const response = await listConflict.request(
      `/knowledge-spaces/${SPACE_ID}/quality/traces?limit=1`,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: revisionError.message });
  });

  it("hides traces when their durable permission or evidence bundle cannot be revalidated", async () => {
    const requestFor = async ({
      revalidatePermissionSnapshot,
      trace,
    }: {
      readonly revalidatePermissionSnapshot: () => Promise<{ readonly revision: number }>;
      readonly trace: AnswerTrace;
    }) => {
      const createBadCase = vi.fn(async () => badCase());
      const app = qualityApp({ createBadCase } as unknown as QualityControlRepository, {
        access: {
          createPermissionSnapshot: vi.fn(async () => ({
            accessChannel: "interactive",
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c73",
            permissionScopes: ["subject:editor-1", "tenant:tenant-1"],
            revision: 23,
          })),
          revalidatePermissionSnapshot,
        } as never,
        answerTraces: { get: vi.fn(async () => trace) } as never,
        assets: { get: vi.fn(async () => null) } as never,
        nodes: { getMany: vi.fn(async () => []) } as never,
      });
      const response = await app.request(`/knowledge-spaces/${SPACE_ID}/quality/bad-cases`, {
        body: JSON.stringify({ reason: "Visibility recheck", traceId: TRACE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return { createBadCase, response };
    };

    const stalePermission = await requestFor({
      revalidatePermissionSnapshot: async () => ({ revision: 2 }),
      trace: visibleTrace(),
    });
    expect(stalePermission.response.status).toBe(404);
    expect(stalePermission.createBadCase).not.toHaveBeenCalled();

    const revokedPermission = await requestFor({
      revalidatePermissionSnapshot: async () => {
        throw new Error("snapshot revoked");
      },
      trace: visibleTrace(),
    });
    expect(revokedPermission.response.status).toBe(404);
    expect(revokedPermission.createBadCase).not.toHaveBeenCalled();

    const inlineFreeTrace = await requestFor({
      revalidatePermissionSnapshot: async () => ({ revision: 1 }),
      trace: { ...visibleTrace(), steps: [] },
    });
    expect(inlineFreeTrace.response.status).toBe(201);
    expect(inlineFreeTrace.createBadCase).toHaveBeenCalledOnce();

    const unresolvedBundle = await requestFor({
      revalidatePermissionSnapshot: async () => ({ revision: 1 }),
      trace: {
        ...visibleTrace(),
        evidenceBundleId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c74",
        steps: [],
      },
    });
    expect(unresolvedBundle.response.status).toBe(404);
    expect(unresolvedBundle.createBadCase).not.toHaveBeenCalled();
  });
});

function qualityApp(
  repository: QualityControlRepository | undefined,
  overrides: {
    readonly access?: Parameters<typeof registerQualityControlHandlers>[0]["access"];
    readonly answerTraces?: Parameters<typeof registerQualityControlHandlers>[0]["answerTraces"];
    readonly assets?: Parameters<typeof registerQualityControlHandlers>[0]["assets"];
    readonly goldenQuestions?: Parameters<
      typeof registerQualityControlHandlers
    >[0]["goldenQuestions"];
    readonly nodes?: Parameters<typeof registerQualityControlHandlers>[0]["nodes"];
    readonly runtimeSnapshots?: Parameters<
      typeof registerQualityControlHandlers
    >[0]["runtimeSnapshots"];
    readonly authenticatedApiKeyKnowledgeSpaceId?: string | undefined;
    readonly authorizationDecision?: unknown;
    readonly callerKind?: "api_key" | "interactive" | undefined;
    readonly capabilityGrant?:
      | {
          readonly callerKind?:
            | "agent"
            | "interactive"
            | "internal_worker"
            | "mcp"
            | "service"
            | "workflow"
            | undefined;
          readonly contentScopeIds: readonly string[];
          readonly grantId: string;
          readonly subject?: string | undefined;
        }
      | undefined;
  } = {},
) {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: [],
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
    context.set("callerKind", overrides.callerKind ?? "interactive");
    if (overrides.authenticatedApiKeyKnowledgeSpaceId) {
      context.set(
        "authenticatedApiKeyKnowledgeSpaceId",
        overrides.authenticatedApiKeyKnowledgeSpaceId,
      );
    }
    if (overrides.capabilityGrant) {
      context.set("capabilityV2Grant", overrides.capabilityGrant as never);
    }
    context.set(
      "authorizationDecision",
      ("authorizationDecision" in overrides
        ? overrides.authorizationDecision
        : {
            accessContext: {},
            permissionSnapshot: {
              apiAccessRevision: 1,
              callerKind: "interactive",
              candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
              issuedAt: NOW,
              knowledgeSpaceId: SPACE_ID,
              memberRevision: 1,
              memberRole: "editor",
              policyRevision: 1,
              subjectId: "editor-1",
              tenantId: "tenant-1",
            },
          }) as never,
    );
    await next();
  });
  registerQualityControlHandlers({
    access: overrides.access ?? ({} as never),
    answerTraces: overrides.answerTraces ?? ({} as never),
    app,
    assets: overrides.assets ?? ({} as never),
    goldenQuestions: overrides.goldenQuestions ?? ({} as never),
    nodes: overrides.nodes ?? ({} as never),
    repository,
    ...(overrides.runtimeSnapshots ? { runtimeSnapshots: overrides.runtimeSnapshots } : {}),
    spaces: {
      get: vi.fn(async (input: { readonly id: string; readonly tenantId: string }) =>
        input.id === SPACE_ID && input.tenantId === "tenant-1"
          ? ({ id: SPACE_ID, tenantId: "tenant-1" } as never)
          : null,
      ),
    },
    now: () => Date.parse(NOW),
  });
  return app;
}

function replayRun(): QualityReplayRun {
  return {
    attempt: 1,
    createdAt: NOW,
    error: "internal database exception with arbitrary-secret",
    frozenSnapshot: {
      embeddingProfile: {
        dimension: 4096,
        model: "user-selected-embed",
        pluginId: "plugin-embed",
        provider: "plugin-daemon",
        revision: 3,
        vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
      },
      projectionSnapshot: {
        fingerprint: "publication-fingerprint-secret",
        headRevision: 12,
        knowledgeSpaceId: SPACE_ID,
        projectionVersion: 8,
        publicationId: "publication-secret",
        tenantId: "tenant-1",
      },
      retrievalCapabilitySnapshot: { raw: "capability-secret" },
      retrievalProfile: {
        defaultMode: "fast",
        reasoningModel: {
          model: "reasoning-model",
          pluginId: "reasoning-plugin-secret",
          provider: "plugin-daemon",
        },
        rerank: { enabled: false },
        revision: 5,
        scoreThreshold: { enabled: true, stage: "mode-final", value: 0.4 },
        topK: 3,
      },
    },
    id: RUN_ID,
    items: [
      {
        expectedEvidenceIds: ["expected-evidence-secret"],
        goldenQuestionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        ordinal: 1,
        question: "camera evidence",
        result: {
          arbitrary: "arbitrary-secret",
          evidenceDiff: {
            missingEvidenceIds: ["expected-evidence-secret"],
            retrievedEvidenceIds: ["retrieved-evidence-secret"],
          },
          metrics: { secretMetric: 99, totalMs: 17 },
          plan: { raw: "raw-plan-secret" },
        },
        state: "failed",
        traceId: "trace-secret",
      },
    ],
    knowledgeSpaceId: SPACE_ID,
    mode: "fast",
    permission: {
      accessChannel: "interactive",
      candidateGrants: ["permission-secret"],
      permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      permissionSnapshotRevision: 9,
      requestedBySubjectId: "editor-1",
    },
    revision: 2,
    state: "failed",
    tenantId: "tenant-1",
    updatedAt: NOW,
  };
}

function badCase(): ProductionBadCase {
  return {
    actorSubjectId: "editor-1",
    createdAt: NOW,
    id: BAD_CASE_ID,
    knowledgeSpaceId: SPACE_ID,
    reason: "Relevant evidence was omitted",
    revision: 1,
    status: "open",
    tags: ["regression"],
    traceId: "trace-capability-secret",
    updatedAt: NOW,
  };
}

function historyEvent(): QualityHistoryEvent {
  return {
    action: "updated",
    actorSubjectId: "editor-1",
    createdAt: NOW,
    fromStatus: "open",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
    reason: "Verified by replay",
    revision: 2,
    toStatus: "fixed",
  };
}

function trendReport(): QualityTrendReport {
  return {
    baseline: { failedQueries: 4, passRate: 0.5, totalReplays: 8 },
    current: {
      badCases: { dismissed: 0, fixed: 1, open: 2, replaying: 0 },
      failedQueries: 2,
      passRate: 0.8,
      totalReplays: 10,
    },
    from: "2026-07-07T15:00:00.000Z",
    slices: [
      {
        failedQueries: 2,
        mode: "fast",
        model: "reasoning-model",
        passRate: 0.8,
        profileRevision: 5,
        replayRuns: 10,
      },
    ],
    to: NOW,
    topUnanswered: [{ count: 2, query: "missing camera evidence" }],
  };
}

function visibleTrace(): AnswerTrace {
  return {
    createdAt: NOW,
    id: TRACE_ID,
    knowledgeSpaceId: SPACE_ID,
    mode: "fast",
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c65",
      revision: 1,
    },
    query: "Which camera evidence is missing?",
    steps: [
      {
        endedAt: NOW,
        metadata: {
          evidenceBundle: {
            createdAt: NOW,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c66",
            items: [],
            missingEvidence: [
              {
                metadata: { source: "camera" },
                reason: "not-retrieved",
                text: "Camera evidence was expected",
              },
            ],
            query: "Which camera evidence is missing?",
            state: "partial",
          },
        },
        name: "retrieval",
        startedAt: NOW,
        status: "ok",
      },
    ],
    subjectId: "editor-1",
  };
}
