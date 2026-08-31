import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
} from "./buffered-document-upload-middleware";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { LegacySpacePublicationBootstrapAdmissionError } from "./legacy-space-publication-bootstrap";
import { StorageQuotaExceededError } from "./storage-quota";
import {
  DirectUploadUnavailableError,
  type UploadSession,
  UploadSessionConflictError,
  UploadSessionIntegrityError,
  UploadSessionNotFoundError,
  type UploadSessionService,
} from "./upload-session";
import {
  DEFAULT_SMALL_FILE_FALLBACK_MAX_CONCURRENCY,
  DEFAULT_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES,
  type SmallFileFallbackAdmission,
  createSmallFileFallbackAdmission,
} from "./upload-session-fallback-admission";
import {
  abortUploadSessionRoute,
  completeUploadSessionRoute,
  createUploadSessionRoute,
  presignUploadSessionPartRoute,
  uploadSmallFileRoute,
} from "./upload-session-routes";

export function registerUploadSessionHandlers(input: {
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly fallbackBodyIdleTimeoutMs?: number | undefined;
  readonly fallbackBodyTotalTimeoutMs?: number | undefined;
  readonly fallbackAdmission?: SmallFileFallbackAdmission | undefined;
  readonly sessions: UploadSessionService;
}): void {
  const fallbackAdmission =
    input.fallbackAdmission ??
    createSmallFileFallbackAdmission({
      maxConcurrency: DEFAULT_SMALL_FILE_FALLBACK_MAX_CONCURRENCY,
      maxReservedBytes: DEFAULT_SMALL_FILE_FALLBACK_MAX_RESERVED_BYTES,
    });
  const fallbackBodyIdleTimeoutMs = positiveSafeInteger(
    input.fallbackBodyIdleTimeoutMs ?? DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
    "fallbackBodyIdleTimeoutMs",
  );
  const fallbackBodyTotalTimeoutMs = positiveSafeInteger(
    input.fallbackBodyTotalTimeoutMs ?? DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
    "fallbackBodyTotalTimeoutMs",
  );
  if (fallbackBodyTotalTimeoutMs < fallbackBodyIdleTimeoutMs) {
    throw new Error(
      "Small-file fallback fallbackBodyTotalTimeoutMs must be at least fallbackBodyIdleTimeoutMs",
    );
  }
  input.app.openapi(createUploadSessionRoute, async (context) => {
    const params = context.req.valid("param");
    const grant = exactGrant(context.get("capabilityV2Grant"), {
      action: "upload_sessions.create",
      id: params.id,
      parentId: null,
      type: "knowledge_space",
    });
    if (!grant) return context.json({ error: "Forbidden" }, 403);
    try {
      const body = context.req.valid("json");
      const result = await input.sessions.create({
        ...body,
        grantId: grant.grantId,
        knowledgeSpaceId: params.id,
        tenantId: grant.namespaceId,
      });
      return context.json(
        {
          session: publicUploadSession(result.session),
          ...(result.upload ? { upload: result.upload } : {}),
        },
        201,
      );
    } catch (error) {
      return uploadSessionError(context, error);
    }
  });

  input.app.openapi(presignUploadSessionPartRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const grant = exactGrant(context.get("capabilityV2Grant"), {
      action: "upload_sessions.write",
      id: params.id,
      parentId: body.knowledgeSpaceId,
      type: "upload_session",
    });
    if (!grant) return context.json({ error: "Forbidden" }, 403);
    try {
      if (!(await sessionBelongsToSpace(input.sessions, grant, params.id, body.knowledgeSpaceId))) {
        return context.json({ error: "Forbidden" }, 403);
      }
      return context.json(
        await input.sessions.presignPart({
          checksumSha256Base64: body.checksumSha256Base64,
          contentLength: body.contentLength,
          partNumber: params.partNumber,
          sessionId: params.id,
          tenantId: grant.namespaceId,
        }),
        200,
      );
    } catch (error) {
      return uploadSessionError(context, error);
    }
  });

  input.app.openapi(uploadSmallFileRoute, async (context) => {
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    const grant = exactGrant(context.get("capabilityV2Grant"), {
      action: "upload_sessions.write",
      id: params.id,
      parentId: query.knowledgeSpaceId,
      type: "upload_session",
    });
    if (!grant) return context.json({ error: "Forbidden" }, 403);
    try {
      const session = await input.sessions.get({
        sessionId: params.id,
        tenantId: grant.namespaceId,
      });
      if (!session) throw new UploadSessionNotFoundError();
      if (session.knowledgeSpaceId !== query.knowledgeSpaceId) {
        return context.json({ error: "Forbidden" }, 403);
      }
      if (session.mode !== "small_fallback") {
        throw new UploadSessionConflictError("Upload session does not allow small-file fallback");
      }
      await fallbackAdmission.run(
        async () => {
          const body = await readExactSmallFileBody(context.req.raw, session.expectedSizeBytes, {
            idleTimeoutMs: fallbackBodyIdleTimeoutMs,
            totalTimeoutMs: fallbackBodyTotalTimeoutMs,
          });
          await input.sessions.putSmallFile({
            body,
            sessionId: params.id,
            tenantId: grant.namespaceId,
          });
        },
        {
          reservedBytes: session.expectedSizeBytes,
          signal: context.req.raw.signal,
        },
      );
      const result = await input.sessions.complete({
        grantId: grant.grantId,
        sessionId: params.id,
        tenantId: grant.namespaceId,
      });
      return context.json({ session: publicUploadSession(result.session) }, 200);
    } catch (error) {
      if (error instanceof SmallFilePayloadTimeoutError) {
        return context.json({ error: error.message }, 408);
      }
      return uploadSessionError(context, error);
    }
  });

  input.app.openapi(completeUploadSessionRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const grant = exactGrant(context.get("capabilityV2Grant"), {
      action: "upload_sessions.complete",
      id: params.id,
      parentId: body.knowledgeSpaceId,
      type: "upload_session",
    });
    if (!grant) return context.json({ error: "Forbidden" }, 403);
    try {
      if (!(await sessionBelongsToSpace(input.sessions, grant, params.id, body.knowledgeSpaceId))) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const result = await input.sessions.complete({
        grantId: grant.grantId,
        ...(body.parts
          ? {
              parts: body.parts.map((part) => ({
                ...(part.checksumSha256Base64 === undefined
                  ? {}
                  : { checksumSha256Base64: part.checksumSha256Base64 }),
                etag: part.etag,
                partNumber: part.partNumber,
              })),
            }
          : {}),
        sessionId: params.id,
        tenantId: grant.namespaceId,
      });
      return context.json({ session: publicUploadSession(result.session) }, 200);
    } catch (error) {
      return uploadSessionError(context, error);
    }
  });

  input.app.openapi(abortUploadSessionRoute, async (context) => {
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    const grant = exactGrant(context.get("capabilityV2Grant"), {
      action: "upload_sessions.abort",
      id: params.id,
      parentId: body.knowledgeSpaceId,
      type: "upload_session",
    });
    if (!grant) return context.json({ error: "Forbidden" }, 403);
    try {
      if (!(await sessionBelongsToSpace(input.sessions, grant, params.id, body.knowledgeSpaceId))) {
        return context.json({ error: "Forbidden" }, 403);
      }
      const session = await input.sessions.abort({
        sessionId: params.id,
        tenantId: grant.namespaceId,
      });
      return context.json({ session: publicUploadSession(session) }, 200);
    } catch (error) {
      return uploadSessionError(context, error);
    }
  });
}

function exactGrant(
  grant: DifyCapabilityV2SanitizedGrant | undefined,
  expected: {
    readonly action: string;
    readonly id: string;
    readonly parentId: string | null;
    readonly type: DifyCapabilityV2SanitizedGrant["resource"]["type"];
  },
): DifyCapabilityV2SanitizedGrant | null {
  if (
    !grant ||
    grant.action !== expected.action ||
    grant.resource.type !== expected.type ||
    grant.resource.id !== expected.id ||
    grant.resource.parent_id !== expected.parentId
  ) {
    return null;
  }
  return grant;
}

async function sessionBelongsToSpace(
  sessions: UploadSessionService,
  grant: DifyCapabilityV2SanitizedGrant,
  sessionId: string,
  knowledgeSpaceId: string,
): Promise<boolean> {
  const session = await sessions.get({ sessionId, tenantId: grant.namespaceId });
  return session?.knowledgeSpaceId === knowledgeSpaceId;
}

function publicUploadSession(session: UploadSession) {
  return {
    ...(session.compilationJobId ? { compilationJobId: session.compilationJobId } : {}),
    ...(session.completedAt === undefined ? {} : { completedAt: session.completedAt }),
    ...(session.documentAssetId ? { documentAssetId: session.documentAssetId } : {}),
    expectedSizeBytes: session.expectedSizeBytes,
    expiresAt: session.expiresAt,
    id: session.id,
    mode: session.mode,
    ...(session.multipartPartCount === undefined
      ? {}
      : { multipartPartCount: session.multipartPartCount }),
    ...(session.multipartPartSizeBytes === undefined
      ? {}
      : { multipartPartSizeBytes: session.multipartPartSizeBytes }),
    status: session.status,
  };
}

function uploadSessionError(
  context: Parameters<Parameters<OpenAPIHono<KnowledgeGatewayEnv>["openapi"]>[1]>[0],
  error: unknown,
) {
  if (error instanceof UploadSessionNotFoundError) {
    return context.json({ error: error.message }, 404);
  }
  if (error instanceof UploadSessionConflictError) {
    return context.json({ error: error.message }, 409);
  }
  if (error instanceof LegacySpacePublicationBootstrapAdmissionError) {
    return context.json({ error: "Knowledge space publication bootstrap is active" }, 409);
  }
  if (error instanceof StorageQuotaExceededError) {
    return context.json({ error: error.message }, 413);
  }
  if (error instanceof SmallFilePayloadTooLargeError) {
    return context.json({ error: error.message }, 413);
  }
  if (error instanceof UploadSessionIntegrityError) {
    return context.json({ error: error.message }, 422);
  }
  if (error instanceof DirectUploadUnavailableError) {
    return context.json({ error: error.message }, 503);
  }
  throw error;
}

class SmallFilePayloadTooLargeError extends Error {
  constructor() {
    super("Small-file fallback payload exceeds the reserved size");
    this.name = "SmallFilePayloadTooLargeError";
  }
}

class SmallFilePayloadTimeoutError extends Error {
  constructor(kind: "idle" | "total") {
    super(`Small-file fallback ${kind} timeout`);
    this.name = "SmallFilePayloadTimeoutError";
  }
}

async function readExactSmallFileBody(
  request: Request,
  expectedSizeBytes: number,
  options: { readonly idleTimeoutMs: number; readonly totalTimeoutMs: number },
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new UploadSessionIntegrityError();
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength)) throw new SmallFilePayloadTooLargeError();
    if (parsedLength > expectedSizeBytes) throw new SmallFilePayloadTooLargeError();
    if (parsedLength < expectedSizeBytes) throw new UploadSessionIntegrityError();
  }

  const reader = request.body?.getReader();
  if (!reader) throw new UploadSessionIntegrityError();
  const body = new Uint8Array(expectedSizeBytes);
  let offset = 0;
  const startedAt = Date.now();
  try {
    while (true) {
      const remainingTotalMs = options.totalTimeoutMs - (Date.now() - startedAt);
      if (remainingTotalMs <= 0) throw new SmallFilePayloadTimeoutError("total");
      const chunk = await readSmallFileChunkWithTimeout(
        reader,
        options.idleTimeoutMs,
        remainingTotalMs,
        request.signal,
      );
      if (chunk.done) break;
      if (chunk.value.byteLength > expectedSizeBytes - offset) {
        throw new SmallFilePayloadTooLargeError();
      }
      body.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedSizeBytes) throw new UploadSessionIntegrityError();
  return body;
}

async function readSmallFileChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  remainingTotalMs: number,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal.throwIfAborted();
  const timeoutMs = Math.min(idleTimeoutMs, remainingTotalMs);
  const timeoutKind = remainingTotalMs <= idleTimeoutMs ? "total" : "idle";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new SmallFilePayloadTimeoutError(timeoutKind));
        }, timeoutMs);
        timer.unref?.();
      }),
      new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(signal.reason);
        signal.addEventListener("abort", abortListener, { once: true });
        // Close the throwIfAborted()/listener-registration handoff race.
        if (signal.aborted) abortListener();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Small-file fallback ${label} must be a positive safe integer`);
  }
  return value;
}
