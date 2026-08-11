import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { GoldenQuestionEvidenceMatchingUnavailableError } from "./golden-question-evidence-matcher";
import { createGoldenEvidenceFixtures } from "./golden-question-test-fixtures";
import {
  createInMemoryFailedQueryRepository,
  createInMemoryGoldenQuestionRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";

const writeToken = "write-token";
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

describe("golden question gateway", () => {
  it("freezes evidence-derived scope and conceals it from a partial member", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const evidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21";
    const requiredScope = `knowledge-space:${knowledgeSpaceId}:member:${writeSubject.subjectId}`;
    const evidence = await createGoldenEvidenceFixtures(
      knowledgeSpaceId,
      [evidenceId],
      [requiredScope],
    );
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a31",
      maxListLimit: 10,
      maxQuestions: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: evidence.assets,
      goldenQuestions,
      knowledgeNodes: evidence.nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
    });
    await createSpace(app, knowledgeSpaceId);
    const created = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/golden-questions`, {
      body: JSON.stringify({ expectedEvidenceIds: [evidenceId], question: "Scoped evidence?" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const question = (await created.json()) as { id: string };

    await expect(
      goldenQuestions.get({
        candidateGrants: [`tenant:${writeSubject.tenantId}`],
        id: question.id,
        knowledgeSpaceId,
        tenantId: writeSubject.tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      goldenQuestions.get({
        candidateGrants: ownerCandidateScopes(knowledgeSpaceId),
        id: question.id,
        knowledgeSpaceId,
        tenantId: writeSubject.tenantId,
      }),
    ).resolves.toMatchObject({ id: question.id });
  });

  it("promotes a failed query atomically and idempotently", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const failedQueryId = "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01";
    const firstEvidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10";
    const secondEvidenceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
    const evidencePermissionScope = [
      `knowledge-space:${knowledgeSpaceId}:member:${writeSubject.subjectId}`,
    ];
    const evidence = await createGoldenEvidenceFixtures(
      knowledgeSpaceId,
      [firstEvidenceId, secondEvidenceId],
      evidencePermissionScope,
    );
    let evidenceAssetReads = 0;
    const replaySafeEvidenceAssets = {
      ...evidence.assets,
      get: async (input: Parameters<typeof evidence.assets.get>[0]) => {
        evidenceAssetReads += 1;
        return evidenceAssetReads === 1 ? evidence.assets.get(input) : null;
      },
    };
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      maxListLimit: 10,
      maxQuestions: 10,
      now: () => "2026-05-11T10:00:00.000Z",
    });
    const failedQueries = createInMemoryFailedQueryRepository({
      generateId: () => failedQueryId,
      goldenQuestions,
      maxFailedQueries: 10,
      now: () => "2026-05-11T09:30:00.000Z",
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      documentAssets: replaySafeEvidenceAssets,
      failedQueries,
      goldenQuestions,
      knowledgeNodes: evidence.nodes,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      now: () => "2026-05-11T10:00:00.000Z",
    });
    await createSpace(app, knowledgeSpaceId);
    await failedQueries.create({
      knowledgeSpaceId,
      mode: "fast",
      permission: {
        accessChannel: "interactive",
        candidateGrants: [`tenant:${writeSubject.tenantId}`],
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f5a01",
        permissionSnapshotRevision: 1,
        requestedBySubjectId: writeSubject.subjectId,
      },
      query: "What is the sensor size?",
      status: "pending-annotation",
      tenantId: writeSubject.tenantId,
      trigger: "no-retrieval-evidence",
    });
    const path = `/knowledge-spaces/${knowledgeSpaceId}/failed-queries/${failedQueryId}`;
    const body = {
      expectedEvidenceIds: [firstEvidenceId],
      note: "Regression coverage",
      verdict: "retrieval-miss",
    };
    const promote = () =>
      app.request(path, {
        body: JSON.stringify(body),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PATCH",
      });

    const first = await promote();
    const replay = await promote();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const firstBody = await first.json();
    expect(await replay.json()).toEqual(firstBody);
    expect(firstBody).toMatchObject({
      id: failedQueryId,
      metadata: {
        annotation: {
          goldenQuestionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
          verdict: "retrieval-miss",
        },
      },
      status: "promoted",
    });
    await expect(
      goldenQuestions.listTrusted({ knowledgeSpaceId, limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01" }],
    });
    await expect(
      goldenQuestions.get({
        candidateGrants: [`tenant:${writeSubject.tenantId}`],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        knowledgeSpaceId,
        tenantId: writeSubject.tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      goldenQuestions.get({
        candidateGrants: [`tenant:${writeSubject.tenantId}`, ...evidencePermissionScope],
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
        knowledgeSpaceId,
        tenantId: writeSubject.tenantId,
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01" });
    const conflict = await app.request(path, {
      body: JSON.stringify({ ...body, expectedEvidenceIds: [secondEvidenceId] }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(conflict.status).toBe(409);
    expect(evidenceAssetReads).toBe(1);
  });

  it("maps a final durable-permission rejection to 403", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const backing = createInMemoryGoldenQuestionRepository({
      maxListLimit: 2,
      maxQuestions: 2,
    });
    let capturedPermission: unknown;
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      goldenQuestions: {
        ...backing,
        create: async (input) => {
          capturedPermission = input.permission;
          throw new KnowledgeSpaceAccessError(
            "space_access_permission_snapshot_invalid",
            "revoked after handler authorization",
          );
        },
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
    });
    await createSpace(app, knowledgeSpaceId);

    const response = await app.request(`/knowledge-spaces/${knowledgeSpaceId}/golden-questions`, {
      body: JSON.stringify({ question: "Must fail closed" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(capturedPermission).toMatchObject({
      permissionSnapshotRevision: 1,
      requestedBySubjectId: writeSubject.subjectId,
      tenantId: writeSubject.tenantId,
    });
  });

  it("matches all CSV evidence once and creates active and draft rows in one batch", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const generatedIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a31",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a32",
    ];
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => generatedIds.shift() as string,
      maxListLimit: 10,
      maxQuestions: 10,
    });
    const matchInputs: string[][] = [];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      goldenQuestionEvidenceMatcher: {
        match: async (input) => {
          matchInputs.push([...input.evidenceTexts]);
          return input.evidenceTexts.map((evidenceText, index) => ({
            candidates:
              index === 0
                ? [
                    {
                      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31",
                      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
                      permissionScope: [`tenant:${writeSubject.tenantId}`],
                      projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d33",
                      score: 0.91,
                      sectionPath: ["Refunds"],
                      text: "Refunds are available for 30 days.",
                    },
                  ]
                : [],
            evidenceText,
            matched: index === 0,
          }));
        },
      },
      goldenQuestions,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      now: () => "2026-08-02T12:00:00.000Z",
    });
    await createSpace(app, knowledgeSpaceId);

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/bulk-import`,
      {
        body: JSON.stringify({
          rows: [
            { evidence: "30 day refund policy", question: "How long is the refund window?" },
            { evidence: "Unpublished warranty", question: "What is the warranty?", tags: ["faq"] },
          ],
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(matchInputs).toEqual([["30 day refund policy", "Unpublished warranty"]]);
    expect(await response.json()).toMatchObject({
      activeCount: 1,
      draftCount: 1,
      items: [
        {
          expectedEvidenceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d32",
          questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a31",
          rowIndex: 0,
          similarity: 0.91,
          status: "active",
        },
        {
          questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a32",
          rowIndex: 1,
          status: "draft",
        },
      ],
    });
    await expect(
      goldenQuestions.listTrusted({ knowledgeSpaceId, limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        { question: "How long is the refund window?" },
        { question: "What is the warranty?" },
      ],
    });
  });

  it("imports valid CSV rows as drafts when an empty space cannot match evidence", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const generatedIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a41",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f3a42",
    ];
    const goldenQuestions = createInMemoryGoldenQuestionRepository({
      generateId: () => generatedIds.shift() as string,
      maxListLimit: 10,
      maxQuestions: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createTestAuthVerifier(),
      goldenQuestionEvidenceMatcher: {
        match: async () => {
          throw new GoldenQuestionEvidenceMatchingUnavailableError(
            "Golden question evidence matching requires an active embedding profile",
          );
        },
      },
      goldenQuestions,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => knowledgeSpaceId,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
    });
    await createSpace(app, knowledgeSpaceId);

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/golden-questions/bulk-import`,
      {
        body: JSON.stringify({
          rows: [
            {
              evidence: "退款期为 30 天",
              question: "退款期多久？",
              tags: ["billing", "政策"],
            },
            {
              evidence: "在设置中启用 SSO",
              question: "如何启用 SSO？",
              tags: ["enterprise", "security"],
            },
          ],
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      activeCount: 0,
      draftCount: 2,
      items: [
        { rowIndex: 0, status: "draft" },
        { rowIndex: 1, status: "draft" },
      ],
    });
    await expect(
      goldenQuestions.listTrusted({ knowledgeSpaceId, limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        { question: "退款期多久？", tags: ["billing", "政策"] },
        { question: "如何启用 SSO？", tags: ["enterprise", "security"] },
      ],
    });
  });
});

async function createSpace(
  app: ReturnType<typeof createKnowledgeGateway>,
  _knowledgeSpaceId: string,
): Promise<void> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Evaluation", slug: "evaluation" }),
    headers: { ...bearer(writeToken), "content-type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(201);
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestAuthVerifier() {
  return createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } });
}

function ownerCandidateScopes(knowledgeSpaceId: string): string[] {
  return [
    `tenant:${writeSubject.tenantId}`,
    `knowledge-space:${knowledgeSpaceId}`,
    `knowledge-space:${knowledgeSpaceId}:member:${writeSubject.subjectId}`,
    `knowledge-space:${knowledgeSpaceId}:role:owner`,
    `knowledge-space:${knowledgeSpaceId}:visibility:only_me:${writeSubject.subjectId}`,
  ].sort();
}
