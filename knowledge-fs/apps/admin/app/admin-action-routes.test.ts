import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as postBadCase } from "./api/admin-bad-case/route";
import { POST as postGcStagedObject } from "./api/admin-gc-staged-object/route";
import { POST as postGoldenAnnotation } from "./api/admin-golden-annotation/route";
import { POST as postGoldenQuestion } from "./api/admin-golden-question/route";
import { POST as postKnowledgeFsWrite } from "./api/admin-knowledge-fs-write/route";
import { POST as postSemanticViews } from "./api/admin-semantic-views/route";

describe("Admin action routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates golden questions from form posts through the JSON API", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      await expect(request.json()).resolves.toEqual({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
        metadata: {},
        question: "What changed?",
        tags: ["retrieval"],
      });
      return Response.json(goldenQuestionResponse(), { status: 201 });
    });

    const response = await postGoldenQuestion(
      formRequest("http://admin.test/api/admin-golden-question", {
        action: "create",
        expectedEvidenceIds: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        question: "What changed?",
        tags: "retrieval",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("adminStatus=success");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions",
      ],
    ]);
  });

  it("rejects invalid golden question workspace ids before calling the API", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("fetch should not be called for invalid golden question workspace ids");
    });

    const invalidWorkspace = await postGoldenQuestion(
      formRequest("http://admin.test/api/admin-golden-question", {
        action: "create",
        knowledgeSpaceId: "workspace",
        question: "What changed?",
      }),
    );

    expect(invalidWorkspace.status).toBe(303);
    expect(invalidWorkspace.headers.get("location")).toContain("Knowledge+space+id+must+be+a+UUID");
  });

  it("creates golden questions with non-UUID expected evidence notes", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      await expect(request.json()).resolves.toEqual({
        expectedEvidenceIds: [],
        metadata: {
          expectedEvidenceInput: "我是 knowledgeFS",
          expectedEvidenceNotes: ["我是 knowledgeFS"],
        },
        question: "What changed?",
        tags: [],
      });
      return Response.json(goldenQuestionResponse(), { status: 201 });
    });

    const response = await postGoldenQuestion(
      formRequest("http://admin.test/api/admin-golden-question", {
        action: "create",
        expectedEvidenceIds: "我是 knowledgeFS",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        question: "What changed?",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("adminStatus=success");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions",
      ],
    ]);
  });

  it("resolves KnowledgeFS expected evidence paths before creating golden questions", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());

      if (
        request.url ===
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fby-topic&limit=100"
      ) {
        return Response.json({
          items: [
            {
              kind: "resource",
              metadata: {},
              name: "roadmap",
              path: "/knowledge/by-topic/roadmap",
              resourceType: "knowledge-node",
              targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01",
            },
          ],
          path: "/knowledge/by-topic",
          truncated: false,
        });
      }

      await expect(request.json()).resolves.toEqual({
        expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
        metadata: {},
        question: "What changed?",
        tags: [],
      });
      return Response.json(goldenQuestionResponse(), { status: 201 });
    });

    const response = await postGoldenQuestion(
      formRequest("http://admin.test/api/admin-golden-question", {
        action: "create",
        expectedEvidenceIds: "/knowledge/by-topic/roadmap",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        question: "What changed?",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("adminStatus=success");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "GET",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/fs/ls?path=%2Fknowledge%2Fby-topic&limit=100",
      ],
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions",
      ],
    ]);
  });

  it("submits annotations and production bad cases through bounded routes", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      return Response.json(goldenQuestionResponse(), { status: 201 });
    });

    const annotationResponse = await postGoldenAnnotation(
      formRequest("http://admin.test/api/admin-golden-annotation", {
        answerCorrectness: "correct",
        evidenceRelevance: "018f0d60-7a49-7cc2-9c1b-5b36f18f4a01=true",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      }),
    );
    const badCaseResponse = await postBadCase(
      formRequest("http://admin.test/api/admin-bad-case", {
        knowledgeSpaceId: "space-1",
        reason: "missed evidence",
        tags: "needs-review",
        traceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01",
      }),
    );

    expect(annotationResponse.status).toBe(303);
    expect(badCaseResponse.status).toBe(303);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01/annotations",
      ],
      ["POST", "http://localhost:8788/knowledge-spaces/space-1/production-bad-cases"],
    ]);
  });

  it("submits annotation relevance notes without requiring evidence UUIDs", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      await expect(request.json()).resolves.toEqual({
        answerCorrectness: "incorrect",
        evidenceRelevance: [],
        note: "Evidence relevance notes: asdadasdsaddsa\nRaw evidence relevance: asdadasdsaddsa",
      });
      return Response.json(goldenQuestionResponse(), { status: 200 });
    });

    const response = await postGoldenAnnotation(
      formRequest("http://admin.test/api/admin-golden-annotation", {
        answerCorrectness: "incorrect",
        evidenceRelevance: "asdadasdsaddsa",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        questionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("adminStatus=success");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/golden-questions/018f0d60-7a49-7cc2-9c1b-5b36f18f3a01/annotations",
      ],
    ]);
  });

  it("executes staged-object GC only with dry-run and candidate idempotency keys", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      await expect(request.json()).resolves.toEqual({
        candidates: [gcCandidate()],
      });
      return Response.json({
        deleted: 1,
        items: [
          {
            idempotencyKey: "staged-object:doc-1",
            objectKey: "tenant-1/spaces/space-1/staging/doc-1.md",
            status: "deleted",
          },
        ],
        skipped: 0,
        tenantId: "tenant-1",
      });
    });

    const missingKey = await postGcStagedObject(
      formRequest("http://admin.test/api/admin-gc-staged-object", {
        candidateJson: JSON.stringify(gcCandidate()),
        dryRunId: "gc-dry-run-1",
        knowledgeSpaceId: "space-1",
      }),
    );
    expect(missingKey.headers.get("location")).toContain("adminStatus=error");

    const response = await postGcStagedObject(
      formRequest("http://admin.test/api/admin-gc-staged-object", {
        candidateJson: JSON.stringify(gcCandidate()),
        dryRunId: "gc-dry-run-1",
        idempotencyKey: "staged-object:doc-1",
        knowledgeSpaceId: "space-1",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("adminStatus=success");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://localhost:8788/knowledge-spaces/space-1/gc/staged-objects/execute"],
    ]);
  });

  it("writes KnowledgeFS text through a POST action and redirects to cat", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());
      await expect(request.json()).resolves.toEqual({
        path: "/knowledge/docs/example.txt",
        text: "hello\n",
      });

      return Response.json({
        bytesWritten: 6,
        mode: "append",
        objectKey: "tenant-1/spaces/space-1/documents/document-1/example.txt",
        path: "/knowledge/docs/example.txt",
        targetId: "document-1",
        version: 1,
      });
    });

    const response = await postKnowledgeFsWrite(
      formRequest("http://admin.test/api/admin-knowledge-fs-write", {
        fsCommand: "append",
        fsPath: "/knowledge/docs/example.txt",
        fsWriteText: "hello\n",
        spaceId: "space-1",
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("fsCommand=cat");
    expect(location).toContain("fsPath=%2Fknowledge%2Fdocs%2Fexample.txt");
    expect(location).toContain("KnowledgeFS+append+wrote+6+bytes");
    expect(location).toContain("#knowledge-fs");
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://localhost:8788/knowledge-spaces/space-1/fs/append"],
    ]);
  });

  it("runs semantic view operator actions from form posts", async () => {
    const requests: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request.clone());

      if (request.url.endsWith("/semantic-views/topic/materialize")) {
        await expect(request.json()).resolves.toEqual({ limit: 50 });
        return Response.json({
          documentCount: 2,
          generatedVersion: "operator-topic-view-v1",
          knowledgeSpaceId: "space-1",
          pathCount: 2,
          topicName: "Uploaded Documents",
          topicSlug: "uploaded-documents",
        });
      }

      if (request.url.endsWith("/semantic-views/communities/materialize")) {
        await expect(request.json()).resolves.toEqual({});
        return Response.json({
          communityCount: 1,
          documentCount: 2,
          entityCount: 3,
          generatedVersion: "operator-community-view-v1",
          knowledgeSpaceId: "space-1",
          pathCount: 3,
        });
      }

      await expect(request.json()).resolves.toEqual({ limit: 50 });
      return Response.json({
        entitiesExtracted: 4,
        extractionMode: "provider",
        graphEntitiesIndexed: 3,
        graphRelationsIndexed: 0,
        knowledgeSpaceId: "space-1",
        nodesScanned: 2,
        nodesUpdated: 2,
      });
    });

    const topicResponse = await postSemanticViews(
      formRequest("http://admin.test/api/admin-semantic-views", {
        action: "materialize-topic",
        knowledgeSpaceId: "space-1",
        limit: "50",
      }),
    );
    const entityResponse = await postSemanticViews(
      formRequest("http://admin.test/api/admin-semantic-views", {
        action: "extract-entities",
        knowledgeSpaceId: "space-1",
        limit: "50",
      }),
    );
    const communityResponse = await postSemanticViews(
      formRequest("http://admin.test/api/admin-semantic-views", {
        action: "materialize-communities",
        knowledgeSpaceId: "space-1",
      }),
    );

    expect(topicResponse.status).toBe(303);
    expect(topicResponse.headers.get("location")).toContain("#semantic-views");
    expect(entityResponse.status).toBe(303);
    expect(entityResponse.headers.get("location")).toContain("Community+view+materialized");
    expect(communityResponse.status).toBe(303);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["POST", "http://localhost:8788/knowledge-spaces/space-1/semantic-views/topic/materialize"],
      ["POST", "http://localhost:8788/knowledge-spaces/space-1/semantic-views/entities/extract"],
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/space-1/semantic-views/communities/materialize",
      ],
      [
        "POST",
        "http://localhost:8788/knowledge-spaces/space-1/semantic-views/communities/materialize",
      ],
    ]);
  });
});

function formRequest(url: string, fields: Readonly<Record<string, string>>): Request {
  return new Request(url, {
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function goldenQuestionResponse(): Record<string, unknown> {
  return {
    createdAt: "2026-05-13T00:00:00.000Z",
    expectedEvidenceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f4a01"],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f3a01",
    knowledgeSpaceId: "space-1",
    metadata: {},
    question: "What changed?",
    tags: ["retrieval"],
    updatedAt: "2026-05-13T00:00:00.000Z",
  };
}

function gcCandidate(): Record<string, unknown> {
  return {
    candidateType: "staged-object",
    count: 1,
    estimatedBytes: 12,
    idempotencyKey: "staged-object:doc-1",
    reason: "expired staged object",
    target: {
      objectKey: "tenant-1/spaces/space-1/staging/doc-1.md",
      type: "staged-object",
    },
  };
}
