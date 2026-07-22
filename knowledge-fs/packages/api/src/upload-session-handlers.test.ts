import { describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import { createKnowledgeGatewayApp } from "./gateway-app";
import { StorageQuotaExceededError } from "./storage-quota";
import type { UploadSession, UploadSessionService } from "./upload-session";
import {
  DirectUploadUnavailableError,
  UploadSessionConflictError,
  UploadSessionIntegrityError,
  UploadSessionNotFoundError,
} from "./upload-session";
import { registerUploadSessionHandlers } from "./upload-session-handlers";

const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";

describe("upload session handlers", () => {
  it("requires a sanitized Capability v2 grant before any session I/O", async () => {
    const fixture = handlerFixture();

    const response = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/upload-sessions`, {
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(fixture.service.create).not.toHaveBeenCalled();
  });

  it("creates a session from the exact Space grant and never exposes internal provenance", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.create",
        id: SPACE_ID,
        parentId: null,
        type: "knowledge_space",
      }),
    });

    const response = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/upload-sessions`, {
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(fixture.service.create).toHaveBeenCalledWith({
      ...createBody(),
      grantId: GRANT_ID,
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    expect(payload).toMatchObject({
      session: { id: SESSION_ID, mode: "single", status: "ready" },
      upload: { method: "PUT", url: "https://objects.example/put" },
    });
    expect(JSON.stringify(payload)).not.toContain("grantId");
    expect(JSON.stringify(payload)).not.toContain("multipartUploadId");
    expect(JSON.stringify(payload)).not.toContain("objectKey");
  });

  it("binds multipart part signing to both the session and its persisted parent Space", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.write",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
      session: { ...uploadSession(), knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d99" },
    });

    const response = await fixture.app.request(`/upload-sessions/${SESSION_ID}/parts/1/presign`, {
      body: JSON.stringify({
        checksumSha256Base64: "part-checksum",
        contentLength: 5 * 1024 * 1024,
        knowledgeSpaceId: SPACE_ID,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(fixture.service.presignPart).not.toHaveBeenCalled();
  });

  it("uploads and completes a bounded small-file fallback with the exact session grant", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.write",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
      session: { ...uploadSession(), expectedSizeBytes: 4, mode: "small_fallback" },
    });

    const response = await fixture.app.request(
      `/upload-sessions/${SESSION_ID}/small-file?knowledgeSpaceId=${SPACE_ID}`,
      {
        body: "tiny",
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(fixture.service.putSmallFile).toHaveBeenCalledWith({
      body: new TextEncoder().encode("tiny"),
      sessionId: SESSION_ID,
      tenantId: "tenant-1",
    });
    expect(fixture.service.complete).toHaveBeenCalledWith({
      grantId: GRANT_ID,
      sessionId: SESSION_ID,
      tenantId: "tenant-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      session: { id: SESSION_ID, mode: "small_fallback", status: "completed" },
    });
  });

  it("rejects cross-Space fallback grants before reading or writing session bytes", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.write",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
      session: { ...uploadSession(), expectedSizeBytes: 4, mode: "small_fallback" },
    });

    const response = await fixture.app.request(
      `/upload-sessions/${SESSION_ID}/small-file?knowledgeSpaceId=018f0d60-7a49-7cc2-9c1b-5b36f18f2d99`,
      {
        body: "tiny",
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(fixture.service.get).not.toHaveBeenCalled();
    expect(fixture.service.putSmallFile).not.toHaveBeenCalled();
    expect(fixture.service.complete).not.toHaveBeenCalled();
  });

  it("does not complete a fallback whose bytes fail checksum validation", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.write",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
      putSmallFileError: new UploadSessionIntegrityError(),
      session: { ...uploadSession(), expectedSizeBytes: 4, mode: "small_fallback" },
    });

    const response = await fixture.app.request(
      `/upload-sessions/${SESSION_ID}/small-file?knowledgeSpaceId=${SPACE_ID}`,
      {
        body: "tiny",
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      },
    );

    expect(response.status).toBe(422);
    expect(fixture.service.complete).not.toHaveBeenCalled();
  });

  it("rejects fallback bytes beyond the exact reservation before storage I/O", async () => {
    const fixture = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.write",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
      session: { ...uploadSession(), expectedSizeBytes: 4, mode: "small_fallback" },
    });

    const response = await fixture.app.request(
      `/upload-sessions/${SESSION_ID}/small-file?knowledgeSpaceId=${SPACE_ID}`,
      {
        body: "large",
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      },
    );

    expect(response.status).toBe(413);
    expect(fixture.service.putSmallFile).not.toHaveBeenCalled();
    expect(fixture.service.complete).not.toHaveBeenCalled();
  });

  it("completes and aborts only through their separate task-scoped actions", async () => {
    const complete = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.complete",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
    });
    const parts = [{ etag: '"etag-1"', partNumber: 1 }];

    const completed = await complete.app.request(`/upload-sessions/${SESSION_ID}/complete`, {
      body: JSON.stringify({ knowledgeSpaceId: SPACE_ID, parts }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(completed.status).toBe(200);
    expect(complete.service.complete).toHaveBeenCalledWith({
      grantId: GRANT_ID,
      parts,
      sessionId: SESSION_ID,
      tenantId: "tenant-1",
    });

    const abort = handlerFixture({
      grant: capabilityGrant({
        action: "upload_sessions.abort",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
    });
    const aborted = await abort.app.request(`/upload-sessions/${SESSION_ID}/abort`, {
      body: JSON.stringify({ knowledgeSpaceId: SPACE_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(aborted.status).toBe(200);
    expect(abort.service.abort).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      tenantId: "tenant-1",
    });
  });

  it("maps final object integrity failures to a stable non-retryable response", async () => {
    const fixture = handlerFixture({
      completeError: new UploadSessionIntegrityError(),
      grant: capabilityGrant({
        action: "upload_sessions.complete",
        id: SESSION_ID,
        parentId: SPACE_ID,
        type: "upload_session",
      }),
    });

    const response = await fixture.app.request(`/upload-sessions/${SESSION_ID}/complete`, {
      body: JSON.stringify({ knowledgeSpaceId: SPACE_ID }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Uploaded object does not match the reserved size and checksum",
    });
  });

  it("rejects every mismatched capability binding", async () => {
    const exact = capabilityGrant({
      action: "upload_sessions.create",
      id: SPACE_ID,
      parentId: null,
      type: "knowledge_space",
    });
    const grants = [
      undefined,
      { ...exact, action: "upload_sessions.write" },
      { ...exact, resource: { ...exact.resource, type: "upload_session" as const } },
      { ...exact, resource: { ...exact.resource, id: SESSION_ID } },
      { ...exact, resource: { ...exact.resource, parent_id: SPACE_ID } },
    ];
    for (const grant of grants) {
      const response = await handlerFixture(grant ? { grant } : {}).app.request(
        `/knowledge-spaces/${SPACE_ID}/upload-sessions`,
        {
          body: JSON.stringify(createBody()),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(response.status).toBe(403);
    }
  });

  it("presigns exact-space parts and handles missing sessions and service errors", async () => {
    const grant = capabilityGrant({
      action: "upload_sessions.write",
      id: SESSION_ID,
      parentId: SPACE_ID,
      type: "upload_session",
    });
    const request = (fixture: ReturnType<typeof handlerFixture>) =>
      fixture.app.request(`/upload-sessions/${SESSION_ID}/parts/1/presign`, {
        body: JSON.stringify({
          checksumSha256Base64: "part-checksum",
          contentLength: 5 * 1024 * 1024,
          knowledgeSpaceId: SPACE_ID,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

    expect((await request(handlerFixture())).status).toBe(403);
    expect((await request(handlerFixture({ grant, session: null }))).status).toBe(403);
    expect((await request(handlerFixture({ grant }))).status).toBe(200);
    expect(
      (await request(handlerFixture({ grant, presignError: new UploadSessionConflictError() })))
        .status,
    ).toBe(409);
  });

  it("covers fallback lookup, space, mode, declared-length, and missing-body boundaries", async () => {
    const grant = capabilityGrant({
      action: "upload_sessions.write",
      id: SESSION_ID,
      parentId: SPACE_ID,
      type: "upload_session",
    });
    const request = (
      fixture: ReturnType<typeof handlerFixture>,
      body: BodyInit | null,
      contentLength?: string,
    ) =>
      fixture.app.request(
        `/upload-sessions/${SESSION_ID}/small-file?knowledgeSpaceId=${SPACE_ID}`,
        {
          ...(body === null ? {} : { body }),
          headers: {
            "content-type": "application/octet-stream",
            ...(contentLength === undefined ? {} : { "content-length": contentLength }),
          },
          method: "POST",
        },
      );

    expect((await request(handlerFixture(), "tiny")).status).toBe(403);
    expect((await request(handlerFixture({ grant, session: null }), "tiny")).status).toBe(404);
    expect(
      (
        await request(
          handlerFixture({ grant, session: { ...uploadSession(), knowledgeSpaceId: "other" } }),
          "tiny",
        )
      ).status,
    ).toBe(403);
    expect((await request(handlerFixture({ grant }), "tiny")).status).toBe(409);

    const fallback = () =>
      handlerFixture({
        grant,
        session: { ...uploadSession(), expectedSizeBytes: 4, mode: "small_fallback" },
      });
    expect((await request(fallback(), "tiny", "bad")).status).toBe(422);
    expect((await request(fallback(), "tiny", "9007199254740992")).status).toBe(413);
    expect((await request(fallback(), "tiny", "5")).status).toBe(413);
    expect((await request(fallback(), "tiny", "3")).status).toBe(422);
    expect((await request(fallback(), null)).status).toBe(422);
    expect((await request(fallback(), "tin")).status).toBe(422);
  });

  it("covers complete and abort authorization, ownership, and optional response fields", async () => {
    const completeGrant = capabilityGrant({
      action: "upload_sessions.complete",
      id: SESSION_ID,
      parentId: SPACE_ID,
      type: "upload_session",
    });
    const completeRequest = (fixture: ReturnType<typeof handlerFixture>, parts?: unknown[]) =>
      fixture.app.request(`/upload-sessions/${SESSION_ID}/complete`, {
        body: JSON.stringify({ knowledgeSpaceId: SPACE_ID, ...(parts ? { parts } : {}) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect((await completeRequest(handlerFixture())).status).toBe(403);
    expect(
      (await completeRequest(handlerFixture({ grant: completeGrant, session: null }))).status,
    ).toBe(403);
    const completed = handlerFixture({
      grant: completeGrant,
      session: {
        ...uploadSession(),
        compilationJobId: "compilation-1",
        completedAt: 2_100_000,
        documentAssetId: "document-1",
        multipartPartCount: 2,
        multipartPartSizeBytes: 5,
      },
    });
    const response = await completeRequest(completed, [
      { checksumSha256Base64: "checksum", etag: "etag", partNumber: 1 },
    ]);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      session: {
        compilationJobId: "compilation-1",
        completedAt: 2_100_000,
        documentAssetId: "document-1",
        multipartPartCount: 2,
        multipartPartSizeBytes: 5,
      },
    });

    const abortGrant = capabilityGrant({
      action: "upload_sessions.abort",
      id: SESSION_ID,
      parentId: SPACE_ID,
      type: "upload_session",
    });
    const abortRequest = (fixture: ReturnType<typeof handlerFixture>) =>
      fixture.app.request(`/upload-sessions/${SESSION_ID}/abort`, {
        body: JSON.stringify({ knowledgeSpaceId: SPACE_ID }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect((await abortRequest(handlerFixture())).status).toBe(403);
    expect((await abortRequest(handlerFixture({ grant: abortGrant, session: null }))).status).toBe(
      403,
    );
    expect(
      (
        await abortRequest(
          handlerFixture({ abortError: new UploadSessionConflictError(), grant: abortGrant }),
        )
      ).status,
    ).toBe(409);
  });

  it.each([
    [new UploadSessionNotFoundError(), 404],
    [new UploadSessionConflictError(), 409],
    [new StorageQuotaExceededError(), 413],
    [new UploadSessionIntegrityError(), 422],
    [new DirectUploadUnavailableError(), 503],
  ] as const)("maps create failure %# to %s", async (createError, status) => {
    const fixture = handlerFixture({
      createError,
      grant: capabilityGrant({
        action: "upload_sessions.create",
        id: SPACE_ID,
        parentId: null,
        type: "knowledge_space",
      }),
    });
    const response = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/upload-sessions`, {
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(status);
  });

  it("omits absent direct-upload instructions and rethrows unexpected session failures", async () => {
    const grant = capabilityGrant({
      action: "upload_sessions.create",
      id: SPACE_ID,
      parentId: null,
      type: "knowledge_space",
    });
    const noUpload = handlerFixture({ createUpload: false, grant });
    const created = await noUpload.app.request(`/knowledge-spaces/${SPACE_ID}/upload-sessions`, {
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(await created.json()).not.toHaveProperty("upload");

    const unknown = handlerFixture({ createError: new Error("unexpected"), grant });
    expect(
      (
        await unknown.app.request(`/knowledge-spaces/${SPACE_ID}/upload-sessions`, {
          body: JSON.stringify(createBody()),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(500);
  });
});

function handlerFixture(
  input: {
    readonly abortError?: Error;
    readonly completeError?: Error;
    readonly createError?: Error;
    readonly createUpload?: boolean;
    readonly grant?: DifyCapabilityV2SanitizedGrant;
    readonly presignError?: Error;
    readonly putSmallFileError?: Error;
    readonly session?: UploadSession | null;
  } = {},
) {
  const app = createKnowledgeGatewayApp();
  const session = "session" in input ? input.session : uploadSession();
  const resultSession = session ?? uploadSession();
  const service = {
    abort: vi.fn(async () => {
      if (input.abortError) throw input.abortError;
      return { ...resultSession, reservedBytes: 0, status: "aborted" as const };
    }),
    cleanupExpired: vi.fn(async () => ({ expired: 0, failed: 0 })),
    complete: vi.fn(async () => {
      if (input.completeError) throw input.completeError;
      return { session: { ...resultSession, status: "completed" as const } };
    }),
    create: vi.fn(async () => {
      if (input.createError) throw input.createError;
      return {
        session: resultSession,
        ...(input.createUpload === false
          ? {}
          : {
              upload: {
                expiresAt: 2_060_000,
                headers: {},
                method: "PUT" as const,
                url: "https://objects.example/put",
              },
            }),
      };
    }),
    get: vi.fn(async () => session),
    presignPart: vi.fn(async () => {
      if (input.presignError) throw input.presignError;
      return {
        expiresAt: 2_060_000,
        headers: {},
        method: "PUT" as const,
        url: "https://objects.example/part",
      };
    }),
    putSmallFile: vi.fn(async () => {
      if (input.putSmallFileError) throw input.putSmallFileError;
    }),
  } satisfies UploadSessionService;
  app.use("*", async (context, next) => {
    context.set("subject", {
      scopes: ["knowledge:write"],
      subjectId: "dify-account:user-1",
      tenantId: "tenant-1",
    });
    context.set("rateLimitChecked", false);
    context.set("traceId", "trace-1");
    if (input.grant) context.set("capabilityV2Grant", input.grant);
    await next();
  });
  registerUploadSessionHandlers({ app, sessions: service });
  return { app, service };
}

function capabilityGrant(input: {
  readonly action: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly type: "knowledge_space" | "upload_session";
}): DifyCapabilityV2SanitizedGrant {
  return {
    action: input.action,
    actor: "dify-account:user-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: [],
    controlSpaceId: "control-space-1",
    expiresAt: 2_060,
    grantId: GRANT_ID,
    issuedAt: 2_000,
    jtiHash: `sha256:${"a".repeat(64)}`,
    namespaceId: "tenant-1",
    notBefore: 2_000,
    resource: { id: input.id, parent_id: input.parentId, type: input.type },
    subject: "dify-account:user-1",
    traceId: "trace-1",
  };
}

function createBody() {
  return {
    checksumSha256Base64: "checksum-base64",
    contentType: "application/pdf",
    expectedSizeBytes: 512,
    fileName: "report.pdf",
    idempotencyKey: "upload-intent-1",
  };
}

function uploadSession(): UploadSession {
  return {
    checksumSha256Base64: "checksum-base64",
    contentType: "application/pdf",
    createdAt: 2_000_000,
    expectedSizeBytes: 512,
    expiresAt: 2_900_000,
    fileName: "report.pdf",
    grantId: GRANT_ID,
    id: SESSION_ID,
    idempotencyKey: "upload-intent-1",
    knowledgeSpaceId: SPACE_ID,
    mode: "single",
    multipartUploadId: "secret-multipart-id",
    objectKey: "secret-object-key",
    reservedBytes: 512,
    rowVersion: 2,
    status: "ready",
    tenantId: "tenant-1",
    updatedAt: 2_000_000,
  };
}
