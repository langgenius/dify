import { Hono } from "hono";
import { type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  DIFY_CAPABILITY_V2_OPERATIONS,
  type DifyCapabilityV2Claims,
  DifyCapabilityV2ClaimsSchema,
  DifyCapabilityV2GuardError,
  type DifyCapabilityV2JwksProvider,
  createDifyCapabilityV2GatewayAuthenticator,
  createDifyCapabilityV2GatewayMiddleware,
  createDifyCapabilityV2RequestGuard,
  createDifyCapabilityV2Verifier,
  createStaticDifyCapabilityV2JwksProvider,
  hashDifyCapabilityJti,
} from "./dify-capability-v2";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const NOW_SECONDS = 1_790_000_000;

function claims(overrides: Partial<DifyCapabilityV2Claims> = {}): DifyCapabilityV2Claims {
  return DifyCapabilityV2ClaimsSchema.parse({
    action: "knowledge_spaces.read",
    actor: "dify-account:account-1",
    aud: "knowledge-fs",
    authz_revision: {
      credential_revision: null,
      external_access_epoch: 3,
      membership_epoch: 5,
      space_acl_epoch: 7,
    },
    azp: "dify-console",
    caller_kind: "interactive",
    cap_ver: 2,
    content_policy_revision: 11,
    content_scope_ids: ["scope-a"],
    control_space_id: "control-space-1",
    exp: NOW_SECONDS + 60,
    grant_id: "grant-1",
    iat: NOW_SECONDS,
    iss: "dify-control-plane",
    jti: "jti-1",
    namespace_id: "workspace-1",
    nbf: NOW_SECONDS,
    resource: { id: "space-1", parent_id: null, type: "knowledge_space" },
    sub: "dify-account:account-1",
    trace_id: "trace-1",
    ...overrides,
  });
}

async function signingMaterial(kid: string) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, alg: "RS256", kid, use: "sig" },
  };
}

async function sign(input: DifyCapabilityV2Claims, kid: string, privateKey: KeyLike) {
  return new SignJWT(input).setProtectedHeader({ alg: "RS256", kid, typ: "JWT" }).sign(privateKey);
}

describe("Dify Capability v2 verifier", () => {
  it("accepts current and previous public keys during overlap", async () => {
    const current = await signingMaterial("current-1");
    const previous = await signingMaterial("previous-1");
    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      jwks: createStaticDifyCapabilityV2JwksProvider({
        keys: [current.publicJwk, previous.publicJwk],
      }),
      now: () => NOW_SECONDS,
    });

    const [currentResult, previousResult] = await Promise.all([
      verifier.verify(await sign(claims(), current.kid, current.privateKey)),
      verifier.verify(
        await sign(claims({ jti: "jti-previous" }), previous.kid, previous.privateKey),
      ),
    ]);

    expect(currentResult?.claims.jti).toBe("jti-1");
    expect(previousResult?.claims.jti).toBe("jti-previous");
    expect(currentResult?.subject).toEqual({
      scopes: ["knowledge-spaces:read"],
      subjectId: "dify-account:account-1",
      tenantId: "workspace-1",
    });
  });

  it("refreshes JWKS once for an unknown kid and still rejects an unknown key", async () => {
    const initial = await signingMaterial("current-1");
    const rotated = await signingMaterial("current-2");
    const calls: boolean[] = [];
    const provider: DifyCapabilityV2JwksProvider = {
      getJwks: async ({ refresh }) => {
        calls.push(refresh);
        return { keys: refresh ? [rotated.publicJwk, initial.publicJwk] : [initial.publicJwk] };
      },
    };
    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      jwks: provider,
      now: () => NOW_SECONDS,
    });

    await expect(
      verifier.verify(await sign(claims(), rotated.kid, rotated.privateKey)),
    ).resolves.toMatchObject({ claims: { jti: "jti-1" } });
    expect(calls).toEqual([false, true]);

    calls.length = 0;
    await expect(
      verifier.verify(await sign(claims(), "never-published", rotated.privateKey)),
    ).resolves.toBeNull();
    expect(calls).toEqual([false, true]);
  });

  it("rejects private JWKS, invalid profile claims, signature/version errors, and clock violations", async () => {
    const key = await signingMaterial("current-1");
    const attacker = await signingMaterial("attacker-1");
    const privateJwk = await exportJWK(key.privateKey);
    expect(() =>
      createStaticDifyCapabilityV2JwksProvider({
        keys: [{ ...privateJwk, alg: "RS256", kid: key.kid, use: "sig" }],
      }),
    ).toThrow("public keys");

    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      clockToleranceSeconds: 5,
      issuer: "dify-control-plane",
      jwks: createStaticDifyCapabilityV2JwksProvider({ keys: [key.publicJwk] }),
      maxTtlSeconds: 60,
      now: () => NOW_SECONDS,
    });
    const invalidTokens = await Promise.all([
      sign(claims({ azp: "dify-workflow" }), key.kid, key.privateKey),
      sign(claims({ actor: "dify-account:other" }), key.kid, key.privateKey),
      sign(claims({ exp: NOW_SECONDS + 61 }), key.kid, key.privateKey),
      sign(claims({ iat: NOW_SECONDS + 6, nbf: NOW_SECONDS + 6 }), key.kid, key.privateKey),
      sign(claims({ aud: "other-service" }), key.kid, key.privateKey),
      sign(claims({ iss: "other-issuer" }), key.kid, key.privateKey),
      sign(claims(), key.kid, attacker.privateKey),
      new SignJWT({ ...claims(), cap_ver: 1 })
        .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
        .sign(key.privateKey),
    ]);

    for (const token of invalidTokens) {
      await expect(verifier.verify(token)).resolves.toBeNull();
    }
  });

  it("keeps internal workers distinct from service credentials", async () => {
    const key = await signingMaterial("current-1");
    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      jwks: createStaticDifyCapabilityV2JwksProvider({ keys: [key.publicJwk] }),
      now: () => NOW_SECONDS,
    });
    const workerClaims = claims({
      actor: "dify-worker:indexer-1",
      azp: "dify-worker",
      caller_kind: "internal_worker",
      sub: "dify-worker:indexer-1",
    });

    await expect(
      verifier.verify(await sign(workerClaims, key.kid, key.privateKey)),
    ).resolves.toMatchObject({
      callerKind: "internal_worker",
      subject: { subjectId: "dify-worker:indexer-1" },
    });
  });
});

describe("Dify Capability v2 request guard", () => {
  it("registers the basic BFF operations with exact method, path, action, and resource", () => {
    const operations = new Map(
      DIFY_CAPABILITY_V2_OPERATIONS.map((operation) => [operation.operationId, operation]),
    );
    expect(operations.get("listKnowledgeSpaces")?.allowedCallerKinds).toContain("internal_worker");
    expect(operations.get("freezeDifyWorkspaceIntegration")).toEqual({
      action: "dify_integration.freeze",
      allowedCallerKinds: ["internal_worker"],
      method: "POST",
      operationId: "freezeDifyWorkspaceIntegration",
      pathTemplate: "/internal/dify-integration/freeze",
      resource: { namespace: true },
      resourceType: "namespace",
    });
    expect(operations.get("activateDifyWorkspaceIntegration")).toEqual({
      action: "dify_integration.activate",
      allowedCallerKinds: ["internal_worker"],
      method: "POST",
      operationId: "activateDifyWorkspaceIntegration",
      pathTemplate: "/internal/dify-integration/activate",
      resource: { namespace: true },
      resourceType: "namespace",
    });
    const expected = {
      createKnowledgeSpaceSource: ["POST", "/knowledge-spaces/{id}/sources", "sources.create"],
      getKnowledgeSpaceProductSettings: [
        "GET",
        "/knowledge-spaces/{id}/product-settings",
        "knowledge_spaces.settings.read",
      ],
      listKnowledgeSpaceQualityTraces: [
        "GET",
        "/knowledge-spaces/{id}/quality/traces",
        "quality.traces.list",
      ],
      listKnowledgeSpaceResearchTasks: [
        "GET",
        "/knowledge-spaces/{id}/research-tasks",
        "research_tasks.list",
      ],
      listKnowledgeSpaceSources: ["GET", "/knowledge-spaces/{id}/sources", "sources.list"],
      updateKnowledgeSpaceProductSettings: [
        "PATCH",
        "/knowledge-spaces/{id}/product-settings",
        "knowledge_spaces.settings.update",
      ],
    } as const;

    for (const [operationId, [method, pathTemplate, action]] of Object.entries(expected)) {
      expect(operations.get(operationId)).toMatchObject({
        action,
        method,
        pathTemplate,
        resource: { pathParameter: "id" },
        resourceType: "knowledge_space",
      });
    }
  });

  it("registers advanced Document, Source, Research, and Trace operations exactly", () => {
    const operations = new Map(
      DIFY_CAPABILITY_V2_OPERATIONS.map((operation) => [operation.operationId, operation]),
    );
    const expected = {
      bulkReindexDocuments: [
        "POST",
        "/knowledge-spaces/{id}/documents/bulk/reindex",
        "documents.bulk.reindex",
        "knowledge_space",
      ],
      cancelDocumentCompilationJob: ["DELETE", "/jobs/{id}", "document_jobs.cancel", "job"],
      cancelResearchTask: [
        "DELETE",
        "/research-tasks/{id}",
        "research_tasks.cancel",
        "research_task",
      ],
      crawlKnowledgeSpaceSource: [
        "POST",
        "/knowledge-spaces/{id}/sources/{sourceId}/crawl",
        "sources.crawl",
        "source",
      ],
      getAnswerTrace: ["GET", "/queries/{traceId}", "queries.read", "query"],
      getBulkOperation: ["GET", "/bulk-jobs/{id}", "bulk_jobs.read", "job"],
      getDocument: [
        "GET",
        "/knowledge-spaces/{id}/documents/{documentId}",
        "documents.read",
        "document",
      ],
      getDocumentChunk: [
        "GET",
        "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks/{chunkId}",
        "documents.chunks.read",
        "document",
      ],
      getDocumentCompilationJob: ["GET", "/jobs/{id}", "document_jobs.read", "job"],
      getDocumentOutline: [
        "GET",
        "/knowledge-spaces/{id}/documents/{documentId}/outline",
        "documents.outline.read",
        "document",
      ],
      getKnowledgeSpaceSource: [
        "GET",
        "/knowledge-spaces/{id}/sources/{sourceId}",
        "sources.read",
        "source",
      ],
      getResearchTask: ["GET", "/research-tasks/{id}", "research_tasks.read", "research_task"],
      importKnowledgeSpaceSourceFiles: [
        "POST",
        "/knowledge-spaces/{id}/sources/{sourceId}/import-files",
        "sources.files.import",
        "source",
      ],
      importKnowledgeSpaceSourcePages: [
        "POST",
        "/knowledge-spaces/{id}/sources/{sourceId}/import",
        "sources.pages.import",
        "source",
      ],
      listDocumentChunks: [
        "GET",
        "/knowledge-spaces/{id}/documents/{documentId}/revisions/{revision}/chunks",
        "documents.chunks.list",
        "document",
      ],
      listDocumentRevisions: [
        "GET",
        "/knowledge-spaces/{id}/documents/{documentId}/revisions",
        "documents.revisions.list",
        "document",
      ],
      listKnowledgeSpaceSourceFiles: [
        "GET",
        "/knowledge-spaces/{id}/sources/{sourceId}/files",
        "sources.files.list",
        "source",
      ],
      listKnowledgeSpaceSourcePages: [
        "GET",
        "/knowledge-spaces/{id}/sources/{sourceId}/pages",
        "sources.pages.list",
        "source",
      ],
      listQueryConflicts: [
        "GET",
        "/queries/{traceId}/conflicts",
        "queries.conflicts.list",
        "query",
      ],
      listQueryEvidence: ["GET", "/queries/{traceId}/evidence", "queries.evidence.list", "query"],
      listQueryMissing: ["GET", "/queries/{traceId}/missing", "queries.missing.list", "query"],
      listResearchTaskPartials: [
        "GET",
        "/research-tasks/{id}/partials",
        "research_tasks.partials.list",
        "research_task",
      ],
      patchDocumentMetadata: [
        "PATCH",
        "/knowledge-spaces/{id}/documents/{documentId}/metadata",
        "documents.metadata.update",
        "document",
      ],
      planResearchTask: ["POST", "/research-tasks/plan", "research_tasks.plan", "knowledge_space"],
      requestBulkDocumentDeletion: [
        "DELETE",
        "/knowledge-spaces/{id}/documents/bulk",
        "documents.bulk.delete",
        "knowledge_space",
      ],
      requestDocumentDeletion: [
        "DELETE",
        "/knowledge-spaces/{id}/documents/{documentId}",
        "documents.delete",
        "document",
      ],
      requestSourceDeletion: [
        "DELETE",
        "/knowledge-spaces/{id}/sources/{sourceId}",
        "sources.delete",
        "source",
      ],
      retryDocumentCompilationJob: ["POST", "/jobs/{id}/retry", "document_jobs.retry", "job"],
      testKnowledgeSpaceSource: [
        "POST",
        "/knowledge-spaces/{id}/sources/{sourceId}/test",
        "sources.test",
        "source",
      ],
      updateKnowledgeSpaceSource: [
        "PATCH",
        "/knowledge-spaces/{id}/sources/{sourceId}",
        "sources.update",
        "source",
      ],
    } as const;

    for (const [operationId, [method, pathTemplate, action, resourceType]] of Object.entries(
      expected,
    )) {
      expect(operations.get(operationId)).toMatchObject({
        action,
        method,
        pathTemplate,
        resourceType,
      });
    }
  });

  it("binds advanced child operations to the exact resource and parent Space", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    const cases = [
      {
        action: "documents.read",
        method: "GET",
        resource: { id: "document-1", parent_id: "space-a", type: "document" },
        url: "https://kfs.test/knowledge-spaces/space-a/documents/document-1",
      },
      {
        action: "sources.test",
        method: "POST",
        resource: { id: "source-1", parent_id: "space-a", type: "source" },
        url: "https://kfs.test/knowledge-spaces/space-a/sources/source-1/test",
      },
      {
        action: "document_jobs.read",
        method: "GET",
        resource: { id: "job-1", parent_id: "space-a", type: "job" },
        url: "https://kfs.test/jobs/job-1?knowledgeSpaceId=space-a",
      },
      {
        action: "queries.evidence.list",
        method: "GET",
        resource: { id: "trace-1", parent_id: "space-a", type: "query" },
        url: "https://kfs.test/queries/trace-1/evidence?knowledgeSpaceId=space-a",
      },
      {
        action: "research_tasks.cancel",
        method: "DELETE",
        resource: { id: "task-1", parent_id: "space-a", type: "research_task" },
        url: "https://kfs.test/research-tasks/task-1?knowledgeSpaceId=space-a",
      },
    ] as const;

    for (const testCase of cases) {
      await expect(
        guard.authorize({
          claims: claims({ action: testCase.action, resource: testCase.resource }),
          request: new Request(testCase.url, { method: testCase.method }),
        }),
      ).resolves.toBeUndefined();
      const wrongParentUrl = testCase.url.replaceAll("space-a", "space-b");
      await expect(
        guard.authorize({
          claims: claims({ action: testCase.action, resource: testCase.resource }),
          request: new Request(wrongParentUrl, { method: testCase.method }),
        }),
      ).rejects.toMatchObject({ code: "PARENT_RESOURCE_MISMATCH" });
    }
  });

  it("registers the exact tenant-scoped batch product-summary operation", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    const batchClaims = claims({
      action: "knowledge_spaces.status.batch",
      resource: { id: "workspace-1", parent_id: null, type: "namespace" },
    });
    const request = new Request(
      "https://kfs.test/internal/knowledge-spaces/product-summaries/batch",
      {
        body: JSON.stringify({ knowledgeSpaceIds: ["space-1"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    await expect(guard.authorize({ claims: batchClaims, request })).resolves.toBeUndefined();
    await expect(
      guard.authorize({
        claims: { ...batchClaims, action: "knowledge_spaces.list" },
        request,
      }),
    ).rejects.toMatchObject({ code: "ACTION_MISMATCH" });
    await expect(
      guard.authorize({
        claims: { ...batchClaims, caller_kind: "workflow" },
        request,
      }),
    ).rejects.toMatchObject({ code: "CALLER_KIND_NOT_ALLOWED" });
  });

  it("rejects space, action, namespace, and body/path mismatches", async () => {
    const guard = createDifyCapabilityV2RequestGuard();

    await expect(
      guard.authorize({
        claims: claims({
          resource: { id: "space-a", parent_id: null, type: "knowledge_space" },
        }),
        request: new Request("https://kfs.test/knowledge-spaces/space-b"),
      }),
    ).rejects.toBeInstanceOf(DifyCapabilityV2GuardError);
    await expect(
      guard.authorize({
        claims: claims({ action: "knowledge_spaces.read" }),
        request: new Request("https://kfs.test/knowledge-spaces/space-1", { method: "PATCH" }),
      }),
    ).rejects.toMatchObject({ code: "ACTION_MISMATCH" });
    await expect(
      guard.authorize({
        claims: claims({
          action: "knowledge_spaces.read",
          resource: { id: "task-1", parent_id: "space-1", type: "research_task" },
        }),
        request: new Request("https://kfs.test/research-tasks/task-1?knowledgeSpaceId=space-1", {
          method: "DELETE",
        }),
      }),
    ).rejects.toMatchObject({ code: "ACTION_MISMATCH" });
    await expect(
      guard.authorize({
        claims: claims({
          action: "knowledge_spaces.list",
          resource: { id: "other-workspace", parent_id: null, type: "namespace" },
        }),
        request: new Request("https://kfs.test/knowledge-spaces"),
      }),
    ).rejects.toMatchObject({ code: "NAMESPACE_MISMATCH" });
    await expect(
      guard.authorize({
        claims: claims({
          action: "queries.create",
          resource: { id: "space-a", parent_id: null, type: "knowledge_space" },
        }),
        request: new Request("https://kfs.test/queries", {
          body: JSON.stringify({ knowledgeSpaceId: "space-b", query: "hello" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_MISMATCH" });
    await expect(
      guard.authorize({
        claims: claims(),
        request: new Request("https://kfs.test/knowledge-spaces//space-1"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      guard.authorize({
        claims: claims({
          action: "knowledge_spaces.update",
          resource: { id: "space-a", parent_id: null, type: "knowledge_space" },
        }),
        request: new Request("https://kfs.test/knowledge-spaces/space-a", {
          body: JSON.stringify({ knowledgeSpaceId: "space-b" }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        }),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_MISMATCH" });
  });

  it("resolves query-bound resources and rejects duplicate or mismatched values", async () => {
    const guard = createDifyCapabilityV2RequestGuard({
      operations: [
        {
          action: "knowledge_spaces.read",
          allowedCallerKinds: ["service"],
          method: "GET",
          operationId: "getInternalSpaceStatus",
          pathTemplate: "/internal/status",
          resource: { queryParameter: "knowledgeSpaceId" },
          resourceType: "knowledge_space",
        },
      ],
    });
    const serviceClaims = claims({
      actor: "dify-kfs-credential:credential-1",
      azp: "dify-service-api",
      caller_kind: "service",
      sub: "dify-kfs-credential:credential-1",
    });

    await expect(
      guard.authorize({
        claims: serviceClaims,
        request: new Request("https://kfs.test/internal/status?knowledgeSpaceId=space-1"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      guard.authorize({
        claims: serviceClaims,
        request: new Request("https://kfs.test/internal/status?knowledgeSpaceId=space-2"),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_MISMATCH" });
    await expect(
      guard.authorize({
        claims: serviceClaims,
        request: new Request(
          "https://kfs.test/internal/status?knowledgeSpaceId=space-1&knowledgeSpaceId=space-1",
        ),
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("binds child resources to their parent space", async () => {
    const guard = createDifyCapabilityV2RequestGuard({
      operations: [
        {
          action: "research_tasks.cancel",
          allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
          method: "POST",
          operationId: "cancelResearchTask",
          parentResource: { pathParameter: "spaceId" },
          pathTemplate: "/knowledge-spaces/{spaceId}/research-tasks/{taskId}/cancel",
          resource: { pathParameter: "taskId" },
          resourceType: "research_task",
        },
      ],
    });

    await expect(
      guard.authorize({
        claims: claims({
          action: "research_tasks.cancel",
          resource: { id: "task-1", parent_id: "space-a", type: "research_task" },
        }),
        request: new Request(
          "https://kfs.test/knowledge-spaces/space-b/research-tasks/task-1/cancel",
          { method: "POST" },
        ),
      }),
    ).rejects.toMatchObject({ code: "PARENT_RESOURCE_MISMATCH" });
  });

  it("does not confuse a child resource id with its body-bound parent space", async () => {
    const guard = createDifyCapabilityV2RequestGuard();

    await expect(
      guard.authorize({
        claims: claims({
          action: "research_tasks.cancel",
          resource: { id: "task-1", parent_id: "space-a", type: "research_task" },
        }),
        request: new Request("https://kfs.test/research-tasks/task-1?knowledgeSpaceId=space-a", {
          method: "DELETE",
        }),
      }),
    ).resolves.toBeUndefined();
  });

  it("binds direct upload operations to the exact session and parent Space", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    await expect(
      guard.authorize({
        claims: claims({
          action: "upload_sessions.create",
          resource: { id: "space-a", parent_id: null, type: "knowledge_space" },
        }),
        request: new Request("https://kfs.test/knowledge-spaces/space-a/upload-sessions", {
          method: "POST",
        }),
      }),
    ).resolves.toBeUndefined();

    for (const [path, action] of [
      ["/upload-sessions/upload-1/parts/7/presign", "upload_sessions.write"],
      ["/upload-sessions/upload-1/complete", "upload_sessions.complete"],
      ["/upload-sessions/upload-1/abort", "upload_sessions.abort"],
    ] as const) {
      await expect(
        guard.authorize({
          claims: claims({
            action,
            resource: { id: "upload-1", parent_id: "space-a", type: "upload_session" },
          }),
          request: new Request(`https://kfs.test${path}`, {
            body: JSON.stringify({ knowledgeSpaceId: "space-a" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }),
        }),
      ).resolves.toBeUndefined();
    }

    await expect(
      guard.authorize({
        claims: claims({
          action: "upload_sessions.write",
          resource: { id: "upload-1", parent_id: "space-a", type: "upload_session" },
        }),
        request: new Request(
          "https://kfs.test/upload-sessions/upload-1/small-file?knowledgeSpaceId=space-a",
          {
            body: "small",
            headers: { "content-type": "application/octet-stream" },
            method: "POST",
          },
        ),
      }),
    ).resolves.toBeUndefined();

    await expect(
      guard.authorize({
        claims: claims({
          action: "upload_sessions.write",
          resource: { id: "upload-1", parent_id: "space-a", type: "upload_session" },
        }),
        request: new Request(
          "https://kfs.test/upload-sessions/upload-1/small-file?knowledgeSpaceId=space-b",
          {
            body: "small",
            headers: { "content-type": "application/octet-stream" },
            method: "POST",
          },
        ),
      }),
    ).rejects.toMatchObject({ code: "PARENT_RESOURCE_MISMATCH" });

    await expect(
      guard.authorize({
        claims: claims({
          action: "upload_sessions.complete",
          resource: { id: "upload-1", parent_id: "space-a", type: "upload_session" },
        }),
        request: new Request("https://kfs.test/upload-sessions/upload-1/complete", {
          body: JSON.stringify({ knowledgeSpaceId: "space-b" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      }),
    ).rejects.toMatchObject({ code: "PARENT_RESOURCE_MISMATCH" });
  });

  it("binds direct Research streams to the exact task and query-bound parent Space", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    const directClaims = claims({
      action: "research_tasks.stream",
      resource: { id: "task-1", parent_id: "space-a", type: "research_task" },
    });

    await expect(
      guard.authorize({
        claims: directClaims,
        request: new Request(
          "https://kfs.test/research-tasks/task-1/events?knowledgeSpaceId=space-a",
        ),
      }),
    ).resolves.toBeUndefined();
    await expect(
      guard.authorize({
        claims: directClaims,
        request: new Request(
          "https://kfs.test/research-tasks/task-1/events?knowledgeSpaceId=space-b",
        ),
      }),
    ).rejects.toMatchObject({ code: "PARENT_RESOURCE_MISMATCH" });
  });

  it("does not authorize integrated provisioning through the legacy create route", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    const provisionClaims = claims({
      action: "knowledge_spaces.provision",
      actor: "dify-kfs-credential:credential-1",
      azp: "dify-service-api",
      caller_kind: "service",
      resource: { id: "workspace-1", parent_id: null, type: "namespace" },
      sub: "dify-kfs-credential:credential-1",
    });

    await expect(
      guard.authorize({
        claims: provisionClaims,
        request: new Request("https://kfs.test/knowledge-spaces", { method: "POST" }),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_NOT_ALLOWED" });
    await expect(
      guard.authorize({
        claims: provisionClaims,
        request: new Request("https://kfs.test/internal/knowledge-spaces/provision", {
          method: "POST",
        }),
      }),
    ).resolves.toBeUndefined();

    for (const callerKind of ["interactive", "workflow"] as const) {
      await expect(
        guard.authorize({
          claims: claims({
            action: "knowledge_spaces.provision",
            caller_kind: callerKind,
            resource: { id: "workspace-1", parent_id: null, type: "namespace" },
          }),
          request: new Request("https://kfs.test/internal/knowledge-spaces/provision", {
            method: "POST",
          }),
        }),
      ).rejects.toMatchObject({ code: "CALLER_KIND_NOT_ALLOWED" });
    }
  });

  it("binds internal revoke and fence operations to the space without treating grantId as resource", async () => {
    const guard = createDifyCapabilityV2RequestGuard();
    const serviceClaims = claims({
      action: "capability_grants.revoke",
      actor: "dify-kfs-credential:credential-1",
      azp: "dify-service-api",
      caller_kind: "service",
      resource: { id: "space-1", parent_id: null, type: "knowledge_space" },
      sub: "dify-kfs-credential:credential-1",
    });

    await expect(
      guard.authorize({
        claims: serviceClaims,
        request: new Request(
          "https://kfs.test/internal/capability-grants/a-different-grant/revoke",
          {
            body: JSON.stringify({ knowledgeSpaceId: "space-1" }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        ),
      }),
    ).resolves.toBeUndefined();
    await expect(
      guard.authorize({
        claims: serviceClaims,
        request: new Request("https://kfs.test/internal/capability-grants/grant-1/revoke", {
          body: JSON.stringify({ knowledgeSpaceId: "space-2" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_MISMATCH" });
    await expect(
      guard.authorize({
        claims: claims({
          action: "knowledge_spaces.fence",
          caller_kind: "workflow",
          resource: { id: "space-1", parent_id: null, type: "knowledge_space" },
        }),
        request: new Request(
          "https://kfs.test/internal/knowledge-spaces/space-1/capability-fence",
          {
            method: "POST",
          },
        ),
      }),
    ).rejects.toMatchObject({ code: "CALLER_KIND_NOT_ALLOWED" });

    const workerDeleteClaims = claims({
      action: "knowledge_spaces.delete",
      actor: "dify-worker:lifecycle-1",
      azp: "dify-worker",
      caller_kind: "internal_worker",
      sub: "dify-worker:lifecycle-1",
    });
    const deleteRequest = new Request("https://kfs.test/internal/knowledge-spaces/space-1/delete", {
      method: "POST",
    });
    await expect(
      guard.authorize({ claims: workerDeleteClaims, request: deleteRequest }),
    ).resolves.toBeUndefined();
    await expect(
      guard.authorize({
        claims: { ...workerDeleteClaims, caller_kind: "service" },
        request: deleteRequest,
      }),
    ).rejects.toMatchObject({ code: "CALLER_KIND_NOT_ALLOWED" });
    await expect(
      guard.authorize({
        claims: { ...workerDeleteClaims, action: "knowledge_spaces.read" },
        request: new Request("https://kfs.test/knowledge-spaces/space-1"),
      }),
    ).rejects.toMatchObject({ code: "CALLER_KIND_NOT_ALLOWED" });
  });
});

describe("Dify Capability v2 audit", () => {
  it("records trace_id and jti_hash without exposing the JWT or raw jti", async () => {
    const key = await signingMaterial("current-1");
    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      jwks: createStaticDifyCapabilityV2JwksProvider({ keys: [key.publicJwk] }),
      now: () => NOW_SECONDS,
    });
    const record = vi.fn();
    const authenticator = createDifyCapabilityV2GatewayAuthenticator({
      audit: { record },
      guard: createDifyCapabilityV2RequestGuard(),
      verifier,
    });
    const token = await sign(claims(), key.kid, key.privateKey);

    const authenticated = await authenticator.authenticate({
      request: new Request("https://kfs.test/knowledge-spaces/space-1"),
      token,
      traceId: "trace-1",
    });

    expect(authenticated).toMatchObject({
      claims: { action: "knowledge_spaces.read" },
      grant: {
        action: "knowledge_spaces.read",
        grantId: "grant-1",
        jtiHash: await hashDifyCapabilityJti("jti-1"),
        traceId: "trace-1",
      },
    });

    expect(record).toHaveBeenCalledWith({
      action: "knowledge_spaces.read",
      callerKind: "interactive",
      jtiHash: await hashDifyCapabilityJti("jti-1"),
      resourceId: "space-1",
      resourceType: "knowledge_space",
      subject: "dify-account:account-1",
      traceId: "trace-1",
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("jti-1");
    expect(JSON.stringify(record.mock.calls)).not.toContain(token);

    const app = new Hono<KnowledgeGatewayEnv>();
    app.use("*", async (context, next) => {
      context.set("traceId", "trace-1");
      await next();
    });
    app.use("*", createDifyCapabilityV2GatewayMiddleware(authenticator));
    app.get("/knowledge-spaces/:id", (context) => context.json(context.get("capabilityV2Grant")));
    const response = await app.request("https://kfs.test/knowledge-spaces/space-1", {
      headers: { authorization: `Bearer ${token}` },
    });
    const handlerGrant: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(handlerGrant).toMatchObject({
      grantId: "grant-1",
      jtiHash: await hashDifyCapabilityJti("jti-1"),
      resource: { id: "space-1", type: "knowledge_space" },
    });
    expect(JSON.stringify(handlerGrant)).not.toContain("jti-1");
    expect(JSON.stringify(handlerGrant)).not.toContain(token);
  });

  it("classifies verification, guard, audit, and successful authorization metrics", async () => {
    const key = await signingMaterial("current-1");
    const verifier = createDifyCapabilityV2Verifier({
      audience: "knowledge-fs",
      issuer: "dify-control-plane",
      jwks: createStaticDifyCapabilityV2JwksProvider({ keys: [key.publicJwk] }),
      now: () => NOW_SECONDS,
    });
    const recordMetric = vi.fn();
    const authenticator = createDifyCapabilityV2GatewayAuthenticator({
      audit: { record: vi.fn() },
      guard: createDifyCapabilityV2RequestGuard(),
      metrics: { record: recordMetric },
      verifier,
    });
    const validToken = await sign(claims(), key.kid, key.privateKey);

    await authenticator.authenticate({
      request: new Request("https://kfs.test/knowledge-spaces/space-1"),
      token: validToken,
      traceId: "trace-1",
    });
    await expect(
      authenticator.authenticate({
        request: new Request("https://kfs.test/knowledge-spaces/space-1", { method: "PATCH" }),
        token: validToken,
        traceId: "trace-1",
      }),
    ).rejects.toMatchObject({ code: "ACTION_MISMATCH" });
    await expect(
      authenticator.authenticate({
        request: new Request("https://kfs.test/knowledge-spaces/space-1"),
        token: "invalid-token",
        traceId: "trace-1",
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    expect(recordMetric.mock.calls.map((call) => call[0])).toEqual([
      {
        action: "knowledge_spaces.read",
        callerKind: "interactive",
        outcome: "success",
        reason: "AUTHORIZED",
        stage: "authorization",
      },
      {
        action: "knowledge_spaces.read",
        callerKind: "interactive",
        outcome: "failure",
        reason: "ACTION_MISMATCH",
        stage: "guard",
      },
      {
        outcome: "failure",
        reason: "AUTHENTICATION_FAILED",
        stage: "verify",
      },
    ]);
    expect(JSON.stringify(recordMetric.mock.calls)).not.toContain("trace-1");
    expect(JSON.stringify(recordMetric.mock.calls)).not.toContain("jti-1");
    expect(JSON.stringify(recordMetric.mock.calls)).not.toContain(validToken);
  });

  it("keeps audit fail-closed while metric export remains best-effort", async () => {
    const verified = {
      callerKind: "interactive" as const,
      claims: claims(),
      subject: {
        scopes: ["knowledge-spaces:read" as const],
        subjectId: "dify-account:account-1",
        tenantId: "workspace-1",
      },
    };
    const auditError = new Error("audit unavailable");
    const auditMetric = vi.fn();
    const auditFailure = createDifyCapabilityV2GatewayAuthenticator({
      audit: { record: vi.fn(async () => Promise.reject(auditError)) },
      guard: { authorize: vi.fn(async () => undefined) },
      metrics: { record: auditMetric },
      verifier: { verify: vi.fn(async () => verified) },
    });

    await expect(
      auditFailure.authenticate({
        request: new Request("https://kfs.test/knowledge-spaces/space-1"),
        token: "opaque-test-token",
        traceId: "trace-1",
      }),
    ).rejects.toBe(auditError);
    expect(auditMetric).toHaveBeenCalledWith({
      action: "knowledge_spaces.read",
      callerKind: "interactive",
      outcome: "failure",
      reason: "AUDIT_FAILED",
      stage: "audit",
    });

    const exporterFailure = createDifyCapabilityV2GatewayAuthenticator({
      audit: { record: vi.fn() },
      guard: { authorize: vi.fn(async () => undefined) },
      metrics: { record: vi.fn(() => Promise.reject(new Error("collector unavailable"))) },
      verifier: { verify: vi.fn(async () => verified) },
    });
    await expect(
      exporterFailure.authenticate({
        request: new Request("https://kfs.test/knowledge-spaces/space-1"),
        token: "opaque-test-token",
        traceId: "trace-1",
      }),
    ).resolves.toMatchObject({ callerKind: "interactive" });
  });

  it("buckets unregistered signed actions instead of exporting an unbounded label", async () => {
    const recordMetric = vi.fn();
    const verified = {
      callerKind: "interactive" as const,
      claims: claims({ action: "unregistered.unique.action" }),
      subject: {
        scopes: ["knowledge-spaces:write" as const],
        subjectId: "dify-account:account-1",
        tenantId: "workspace-1",
      },
    };
    const authenticator = createDifyCapabilityV2GatewayAuthenticator({
      audit: { record: vi.fn() },
      guard: { authorize: vi.fn(async () => undefined) },
      metrics: { record: recordMetric },
      verifier: { verify: vi.fn(async () => verified) },
    });

    await authenticator.authenticate({
      request: new Request("https://kfs.test/knowledge-spaces/space-1"),
      token: "opaque-test-token",
      traceId: "trace-1",
    });

    expect(recordMetric).toHaveBeenCalledWith({
      action: "unknown",
      callerKind: "interactive",
      outcome: "success",
      reason: "AUTHORIZED",
      stage: "authorization",
    });
    expect(JSON.stringify(recordMetric.mock.calls)).not.toContain("unregistered.unique.action");
  });
});
