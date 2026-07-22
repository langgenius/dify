import type { GoldenQuestion } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { encodeGoldenQuestionCursor } from "./cursor-utils";
import {
  goldenQuestionEvidencePermissionScope,
  registerGoldenQuestionHandlers,
} from "./golden-question-handlers";
import {
  GoldenQuestionCapacityExceededError,
  GoldenQuestionListLimitExceededError,
} from "./golden-question-repository";
import {
  annotateGoldenQuestionRoute,
  createGoldenQuestionRoute,
  deleteGoldenQuestionRoute,
  getGoldenQuestionRoute,
  listGoldenQuestionsRoute,
  updateGoldenQuestionRoute,
} from "./golden-question-routes";
import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const QUESTION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };

describe("golden-question handler branch coverage", () => {
  it("returns not found for every route when the space is absent", async () => {
    const fixture = goldenFixture({ space: null });
    for (const route of [
      createGoldenQuestionRoute,
      listGoldenQuestionsRoute,
      getGoldenQuestionRoute,
      updateGoldenQuestionRoute,
      annotateGoldenQuestionRoute,
      deleteGoldenQuestionRoute,
    ]) {
      expect((await fixture.invoke(route)).status).toBe(404);
    }
  });

  it("creates questions, rejects missing evidence, and maps capacity or permission failures", async () => {
    const created = goldenFixture({ body: { expectedEvidenceIds: [], question: "Question?" } });
    expect((await created.invoke(createGoldenQuestionRoute)).status).toBe(201);
    expect(created.questions.create).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPermissionScope: [] }),
    );

    const missingEvidence = goldenFixture({
      asset: null,
      body: { expectedEvidenceIds: [ASSET_ID], question: "Question?" },
    });
    expect((await missingEvidence.invoke(createGoldenQuestionRoute)).status).toBe(404);

    const capacity = goldenFixture({ createError: new GoldenQuestionCapacityExceededError(1) });
    expect((await capacity.invoke(createGoldenQuestionRoute)).status).toBe(429);

    for (const permissionError of [
      new KnowledgeSpaceAccessError("space_access_forbidden", "denied"),
      new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied"),
    ]) {
      const denied = goldenFixture({ permissionError });
      expect((await denied.invoke(createGoldenQuestionRoute)).status).toBe(403);
    }
  });

  it("lists cursor pages, denies invalid read scopes, and maps list validation", async () => {
    const page = goldenFixture({
      listResult: {
        items: [question()],
        nextCursor: { createdAt: "2026-07-14T12:00:00.000Z", id: QUESTION_ID },
      },
      query: {
        cursor: encodeGoldenQuestionCursor({
          createdAt: "2026-07-14T12:00:00.000Z",
          id: QUESTION_ID,
        }),
        limit: 5,
      },
    });
    expect(await page.invoke(listGoldenQuestionsRoute)).toMatchObject({
      body: { items: [{ id: QUESTION_ID }], nextCursor: expect.any(String) },
      status: 200,
    });

    const empty = goldenFixture({ listResult: { items: [] }, query: { limit: 5 } });
    expect(await empty.invoke(listGoldenQuestionsRoute)).toEqual({
      body: { items: [] },
      status: 200,
    });

    for (const options of [
      { decision: undefined },
      { callerKind: "api_key", keySpaceId: "another-space" },
    ] as const) {
      expect((await goldenFixture(options).invoke(listGoldenQuestionsRoute)).status).toBe(403);
      expect((await goldenFixture(options).invoke(getGoldenQuestionRoute)).status).toBe(404);
    }

    for (const listError of [
      new GoldenQuestionListLimitExceededError(1),
      new KnowledgeFsValidationError("invalid cursor"),
    ]) {
      expect((await goldenFixture({ listError }).invoke(listGoldenQuestionsRoute)).status).toBe(
        400,
      );
    }
  });

  it("gets existing questions and hides absent rows", async () => {
    expect(await goldenFixture().invoke(getGoldenQuestionRoute)).toMatchObject({
      body: { id: QUESTION_ID },
      status: 200,
    });
    expect((await goldenFixture({ existing: null }).invoke(getGoldenQuestionRoute)).status).toBe(
      404,
    );
  });

  it("updates with omitted, valid, or missing evidence and handles a lost row", async () => {
    const omitted = goldenFixture({ body: { question: "Updated?" } });
    expect((await omitted.invoke(updateGoldenQuestionRoute)).status).toBe(200);
    expect(omitted.questions.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ requiredPermissionScope: expect.anything() }),
    );

    const valid = goldenFixture({ body: { expectedEvidenceIds: [], question: "Updated?" } });
    expect((await valid.invoke(updateGoldenQuestionRoute)).status).toBe(200);
    expect(valid.questions.update).toHaveBeenCalledWith(
      expect.objectContaining({ requiredPermissionScope: [] }),
    );

    const missing = goldenFixture({ asset: null, body: { expectedEvidenceIds: [ASSET_ID] } });
    expect((await missing.invoke(updateGoldenQuestionRoute)).status).toBe(404);

    const lost = goldenFixture({ updated: null });
    expect((await lost.invoke(updateGoldenQuestionRoute)).status).toBe(404);
  });

  it("annotates existing questions and handles missing input or output rows", async () => {
    const success = goldenFixture({
      body: { answerCorrectness: "correct", evidenceRelevance: [], note: "reviewed" },
    });
    expect((await success.invoke(annotateGoldenQuestionRoute)).status).toBe(200);
    expect(success.questions.update).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining(["annotated"]) }),
    );

    expect(
      (await goldenFixture({ existing: null }).invoke(annotateGoldenQuestionRoute)).status,
    ).toBe(404);
    expect(
      (
        await goldenFixture({
          body: { answerCorrectness: "correct", evidenceRelevance: [] },
          updated: null,
        }).invoke(annotateGoldenQuestionRoute)
      ).status,
    ).toBe(404);
  });

  it("deletes an existing question and returns not found for an absent row", async () => {
    expect((await goldenFixture({ deleted: true }).invoke(deleteGoldenQuestionRoute)).status).toBe(
      204,
    );
    expect((await goldenFixture({ deleted: false }).invoke(deleteGoldenQuestionRoute)).status).toBe(
      404,
    );
  });

  it("maps permission failures for update, annotation, and deletion and preserves unexpected failures", async () => {
    const denied = new KnowledgeSpaceAccessError("space_access_forbidden", "denied");
    for (const route of [
      updateGoldenQuestionRoute,
      annotateGoldenQuestionRoute,
      deleteGoldenQuestionRoute,
    ]) {
      expect((await goldenFixture({ permissionError: denied }).invoke(route)).status).toBe(403);
    }

    const unexpected = new Error("permission backend failed");
    for (const route of [
      createGoldenQuestionRoute,
      updateGoldenQuestionRoute,
      annotateGoldenQuestionRoute,
      deleteGoldenQuestionRoute,
    ]) {
      await expect(goldenFixture({ permissionError: unexpected }).invoke(route)).rejects.toBe(
        unexpected,
      );
    }
  });

  it("binds API-key expiry into write permission snapshots", async () => {
    const fixture = goldenFixture({
      apiKey: { expiresAt: "2026-07-14T13:00:00.000Z", id: "key-1", revision: 2 },
      callerKind: "api_key",
      keySpaceId: SPACE_ID,
    });
    expect((await fixture.invoke(createGoldenQuestionRoute)).status).toBe(201);
    expect(fixture.createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: expect.objectContaining({ id: "key-1" }) }),
    );
  });
});

describe("golden-question evidence permission scope branches", () => {
  it("handles empty, duplicate, direct-asset, and node-backed evidence", async () => {
    await expect(evidenceScope({ expectedEvidenceIds: [] })).resolves.toEqual([]);
    await expect(evidenceScope({ expectedEvidenceIds: [ASSET_ID, ASSET_ID] })).resolves.toBeNull();
    await expect(
      evidenceScope({ asset: null, expectedEvidenceIds: [ASSET_ID] }),
    ).resolves.toBeNull();
    await expect(evidenceScope({ expectedEvidenceIds: [ASSET_ID] })).resolves.toEqual([]);
    await expect(
      evidenceScope({
        expectedEvidenceIds: [NODE_ID],
        nodes: [{ documentAssetId: ASSET_ID, id: NODE_ID, permissionScope: ["team:a"] }],
        candidateGrants: ["team:a"],
      }),
    ).resolves.toEqual(["team:a"]);
  });

  it("fails closed for missing backing assets and hidden or malformed node and asset scopes", async () => {
    const node = { documentAssetId: ASSET_ID, id: NODE_ID, permissionScope: ["team:a"] };
    await expect(
      evidenceScope({
        asset: null,
        candidateGrants: ["team:a"],
        expectedEvidenceIds: [NODE_ID],
        nodes: [node],
      }),
    ).resolves.toBeNull();
    await expect(
      evidenceScope({ candidateGrants: [], expectedEvidenceIds: [NODE_ID], nodes: [node] }),
    ).resolves.toBeNull();
    await expect(
      evidenceScope({
        candidateGrants: ["team:a"],
        expectedEvidenceIds: [NODE_ID],
        nodes: [{ ...node, permissionScope: "malformed" }],
      }),
    ).resolves.toBeNull();
    await expect(
      evidenceScope({
        asset: { metadata: { permissionScope: ["team:b"] } },
        candidateGrants: ["team:a"],
        expectedEvidenceIds: [NODE_ID],
        nodes: [node],
      }),
    ).resolves.toBeNull();
    await expect(
      evidenceScope({
        asset: { metadata: { permissionScope: "malformed" } },
        candidateGrants: ["team:a"],
        expectedEvidenceIds: [NODE_ID],
        nodes: [node],
      }),
    ).resolves.toBeNull();
  });
});

interface GoldenFixtureOptions {
  readonly apiKey?: unknown;
  readonly asset?: unknown;
  readonly body?: Record<string, unknown>;
  readonly callerKind?: string;
  readonly createError?: Error;
  readonly decision?: unknown;
  readonly deleted?: boolean;
  readonly existing?: GoldenQuestion | null;
  readonly keySpaceId?: string;
  readonly listError?: Error;
  readonly listResult?: { readonly items: GoldenQuestion[]; readonly nextCursor?: unknown };
  readonly permissionError?: Error;
  readonly query?: Record<string, unknown>;
  readonly space?: unknown;
  readonly updated?: GoldenQuestion | null;
}

function goldenFixture(options: GoldenFixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const createPermissionSnapshot = vi.fn(async () => {
    if (options.permissionError) throw options.permissionError;
    return {
      accessChannel: options.callerKind === "api_key" ? "service_api" : "interactive",
      id: "permission-1",
      permissionScopes: [],
      revision: 1,
      role: "editor",
    };
  });
  const authorize = vi.fn(async () => {
    if (options.permissionError) throw options.permissionError;
    return { permissionSnapshot: { candidateGrants: [] } };
  });
  const create = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return question();
  });
  const update = vi.fn(async () =>
    options.updated === undefined ? question({ question: "Updated?" }) : options.updated,
  );
  const questions = {
    create,
    delete: vi.fn(async () => options.deleted ?? true),
    get: vi.fn(async () => (options.existing === undefined ? question() : options.existing)),
    list: vi.fn(async () => {
      if (options.listError) throw options.listError;
      return options.listResult ?? { items: [] };
    }),
    update,
  };
  registerGoldenQuestionHandlers({
    access: { createPermissionSnapshot, revalidatePermissionSnapshot: vi.fn() } as never,
    answerTraceRepository: { getById: vi.fn() } as never,
    app: app as never,
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { metadata: {} } : options.asset)),
    } as never,
    authorization: { authorize } as never,
    nodes: { getMany: vi.fn(async () => []) } as never,
    now: () => "2026-07-14T12:00:00.000Z",
    questions: questions as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });
  return {
    createPermissionSnapshot,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(goldenContext(options) as never);
    },
    questions: { create, update },
  };
}

function goldenContext(options: GoldenFixtureOptions) {
  const defaultDecision = {
    permissionSnapshot: {
      candidateGrants: [],
      knowledgeSpaceId: SPACE_ID,
      subjectId: SUBJECT.subjectId,
      tenantId: SUBJECT.tenantId,
    },
  };
  const values = new Map<string, unknown>([
    ["authenticatedApiKey", options.apiKey],
    ["authenticatedApiKeyKnowledgeSpaceId", options.keySpaceId],
    ["authorizationDecision", "decision" in options ? options.decision : defaultDecision],
    ["callerKind", options.callerKind],
    ["subject", SUBJECT],
  ]);
  return {
    body: (body: unknown, status: number) => ({ body, status }),
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      valid: (part: string) => {
        if (part === "param") return { id: SPACE_ID, questionId: QUESTION_ID };
        if (part === "json") return options.body ?? { question: "Question?" };
        return options.query ?? { limit: 10 };
      },
    },
  };
}

function evidenceScope(options: {
  readonly asset?: unknown;
  readonly candidateGrants?: readonly string[];
  readonly expectedEvidenceIds: readonly string[];
  readonly nodes?: readonly unknown[];
}) {
  return goldenQuestionEvidencePermissionScope({
    assets: {
      get: vi.fn(async () => (options.asset === undefined ? { metadata: {} } : options.asset)),
    } as never,
    candidateGrants: options.candidateGrants ?? [],
    expectedEvidenceIds: options.expectedEvidenceIds,
    knowledgeSpaceId: SPACE_ID,
    nodes: { getMany: vi.fn(async () => options.nodes ?? []) } as never,
  });
}

function question(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    expectedEvidenceIds: [],
    id: QUESTION_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    question: "Question?",
    tags: [],
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...overrides,
  };
}
