import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

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
