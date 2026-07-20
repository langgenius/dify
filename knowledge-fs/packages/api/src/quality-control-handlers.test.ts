import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import type { QualityControlRepository, QualityReplayRun } from "./quality-control";
import { registerQualityControlHandlers } from "./quality-control-handlers";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
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
});

function qualityApp(
  repository: QualityControlRepository,
  overrides: {
    readonly access?: Parameters<typeof registerQualityControlHandlers>[0]["access"];
    readonly runtimeSnapshots?: Parameters<
      typeof registerQualityControlHandlers
    >[0]["runtimeSnapshots"];
  } = {},
) {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: [],
      subjectId: "editor-1",
      tenantId: "tenant-1",
    });
    context.set("callerKind", "interactive");
    context.set("authorizationDecision", {
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
    } as never);
    await next();
  });
  registerQualityControlHandlers({
    access: overrides.access ?? ({} as never),
    answerTraces: {} as never,
    app,
    assets: {} as never,
    goldenQuestions: {} as never,
    nodes: {} as never,
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
