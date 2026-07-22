import { describe, expect, it, vi } from "vitest";

import { CandidateVisibilityScanBudgetExceededError } from "./candidate-content-authorization";
import { DeletionLifecycleFenceActiveError } from "./deletion-lifecycle-fence";
import { DeletionObjectWriteAdmissionError } from "./deletion-object-write-admission";
import { KnowledgeFsUnavailableError } from "./gateway-defaults";
import { KnowledgeFsNotFoundError, KnowledgeFsValidationError } from "./knowledge-fs-errors";
import { registerKnowledgeFsHandlers } from "./knowledge-fs-handlers";
import {
  appendKnowledgeFsRoute,
  catKnowledgeFsRoute,
  diffKnowledgeFsRoute,
  findKnowledgeFsRoute,
  grepKnowledgeFsRoute,
  listKnowledgeFsRoute,
  openNodeKnowledgeFsRoute,
  statKnowledgeFsRoute,
  treeKnowledgeFsRoute,
  writeKnowledgeFsRoute,
} from "./knowledge-fs-routes";
import { KnowledgePathListLimitExceededError } from "./knowledge-path-repository";
import {
  KnowledgeSpaceDocumentMutationLeaseActiveError,
  LegacySpacePublicationBootstrapAdmissionError,
} from "./legacy-space-publication-bootstrap";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SUBJECT = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };

const ROUTES = [
  [listKnowledgeFsRoute, "ls"],
  [treeKnowledgeFsRoute, "tree"],
  [grepKnowledgeFsRoute, "grep"],
  [findKnowledgeFsRoute, "find"],
  [diffKnowledgeFsRoute, "diff"],
  [openNodeKnowledgeFsRoute, "open_node"],
  [catKnowledgeFsRoute, "cat"],
  [statKnowledgeFsRoute, "stat"],
  [writeKnowledgeFsRoute, "write"],
  [appendKnowledgeFsRoute, "append"],
] as const;

describe("KnowledgeFS handler branch coverage", () => {
  it("executes every command with the current candidate scope", async () => {
    const fixture = handlersFixture();

    for (const [route, command] of ROUTES) {
      const response = await fixture.invoke(route);
      expect(response).toEqual({ body: { command }, status: 200 });
    }

    expect(fixture.execute).toHaveBeenCalledTimes(ROUTES.length);
    for (const [, command] of ROUTES) {
      expect(fixture.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            candidatePermissionScope: [],
            knowledgeSpaceId: SPACE_ID,
          }),
          name: command,
        }),
      );
    }
  });

  it("returns not found before executing every command when the space is absent", async () => {
    const fixture = handlersFixture({ space: null });

    for (const [route] of ROUTES) {
      const response = await fixture.invoke(route);
      expect(response.status).toBe(404);
    }
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it("denies every command when the authorization decision has no current candidate scope", async () => {
    const fixture = handlersFixture({ decision: undefined });

    for (const [route] of ROUTES) {
      const response = await fixture.invoke(route);
      expect(response).toEqual({ body: { error: "Knowledge space access denied" }, status: 403 });
    }
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each([
    [new CandidateVisibilityScanBudgetExceededError(), 503],
    [new KnowledgeFsNotFoundError("missing"), 404],
    [new KnowledgePathListLimitExceededError(1), 400],
    [new KnowledgeFsValidationError("invalid"), 400],
  ] as const)("maps read-list family error %# to %s", async (error, status) => {
    const fixture = handlersFixture({ executeError: error });
    for (const route of [
      listKnowledgeFsRoute,
      treeKnowledgeFsRoute,
      grepKnowledgeFsRoute,
      findKnowledgeFsRoute,
    ]) {
      expect((await fixture.invoke(route)).status).toBe(status);
    }
  });

  it("maps command-specific read failures", async () => {
    for (const route of [
      diffKnowledgeFsRoute,
      openNodeKnowledgeFsRoute,
      catKnowledgeFsRoute,
      statKnowledgeFsRoute,
    ]) {
      const missing = handlersFixture({ executeError: new KnowledgeFsNotFoundError("missing") });
      expect((await missing.invoke(route)).status).toBe(404);
    }

    const unavailable = handlersFixture({
      executeError: new KnowledgeFsUnavailableError("projection unavailable"),
    });
    expect(await unavailable.invoke(diffKnowledgeFsRoute)).toEqual({
      body: { error: "projection unavailable" },
      status: 503,
    });
  });

  it.each([
    [new KnowledgeFsNotFoundError("missing"), 404],
    [new KnowledgeFsValidationError("invalid"), 400],
    [
      new DeletionLifecycleFenceActiveError({
        deletionJobId: "job-1",
        targetId: SPACE_ID,
        targetType: "knowledge_space",
      } as never),
      409,
    ],
    [new DeletionObjectWriteAdmissionError(), 409],
    [new LegacySpacePublicationBootstrapAdmissionError("bootstrap-1"), 409],
    [new KnowledgeSpaceDocumentMutationLeaseActiveError(), 409],
  ] as const)("maps mutation error %# to %s", async (error, status) => {
    const fixture = handlersFixture({ executeError: error });
    expect((await fixture.invoke(writeKnowledgeFsRoute)).status).toBe(status);
    expect((await fixture.invoke(appendKnowledgeFsRoute)).status).toBe(status);
  });

  it("lets unexpected mutation failures escape to the application error boundary", async () => {
    const failure = new Error("unexpected mutation failure");
    const fixture = handlersFixture({ executeError: failure });
    await expect(fixture.invoke(writeKnowledgeFsRoute)).rejects.toBe(failure);
    await expect(fixture.invoke(appendKnowledgeFsRoute)).rejects.toBe(failure);
  });
});

interface FixtureOptions {
  readonly decision?: unknown;
  readonly executeError?: Error;
  readonly space?: unknown;
}

function handlersFixture(options: FixtureOptions = {}) {
  const callbacks = new Map<
    unknown,
    (context: never) => Promise<{ body: unknown; status: number }>
  >();
  const app = {
    openapi: vi.fn((route: unknown, callback: (context: never) => Promise<never>) => {
      callbacks.set(route, callback as never);
    }),
  };
  const execute = vi.fn(async (input: { readonly name: string }) => {
    if (options.executeError) throw options.executeError;
    return { output: { command: input.name } };
  });
  registerKnowledgeFsHandlers({
    app: app as never,
    fsCommands: { execute } as never,
    spaces: {
      get: vi.fn(async () => (options.space === undefined ? { id: SPACE_ID } : options.space)),
    } as never,
  });

  return {
    execute,
    invoke: async (route: unknown) => {
      const callback = callbacks.get(route);
      if (!callback) throw new Error("route was not registered");
      return callback(
        context({
          decision:
            "decision" in options
              ? options.decision
              : {
                  permissionSnapshot: {
                    candidateGrants: [],
                    knowledgeSpaceId: SPACE_ID,
                    subjectId: SUBJECT.subjectId,
                    tenantId: SUBJECT.tenantId,
                  },
                },
        }) as never,
      );
    },
  };
}

function context({ decision }: { readonly decision: unknown }) {
  const values = new Map<string, unknown>([
    ["authorizationDecision", decision],
    ["subject", SUBJECT],
    ["traceId", "trace-1"],
  ]);
  return {
    get: (key: string) => values.get(key),
    json: (body: unknown, status: number) => ({ body, status }),
    req: {
      valid: (part: string) => {
        if (part === "param") return { id: SPACE_ID, nodeId: "node-1" };
        if (part === "json") return { content: "content", path: "/notes/a.md" };
        return { path: "/", pattern: "needle" };
      },
    },
  };
}
