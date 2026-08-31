import type { OpenAPIHono } from "@hono/zod-openapi";

import type { BufferedDocumentUploadAdmission } from "./buffered-document-upload-admission";
import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

const MULTIPART_BASE_OVERHEAD_BYTES = 64 * 1024;
const MULTIPART_PER_FILE_OVERHEAD_BYTES = 16 * 1024;
export const DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS = 30_000;
export const DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS = 10 * 60_000;

class BufferedDocumentUploadRequestTooLargeError extends Error {
  constructor(readonly maxRequestBytes: number) {
    super(`Buffered document upload exceeds maxRequestBytes=${maxRequestBytes}`);
  }
}

class BufferedDocumentUploadContentLengthError extends Error {
  constructor() {
    super("Buffered document upload Content-Length must be a non-negative safe integer");
  }
}

class BufferedDocumentUploadTimeoutError extends Error {
  constructor(kind: "idle" | "total") {
    super(`Buffered document upload ${kind} timeout`);
  }
}

export function bufferedDocumentUploadMaxRequestBytes(
  maxPayloadBytes: number,
  maxFiles: number,
): number {
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) {
    throw new Error("Buffered document upload maxPayloadBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1) {
    throw new Error("Buffered document upload maxFiles must be a positive safe integer");
  }
  const overhead = MULTIPART_BASE_OVERHEAD_BYTES + maxFiles * MULTIPART_PER_FILE_OVERHEAD_BYTES;
  if (maxPayloadBytes > Number.MAX_SAFE_INTEGER - overhead) {
    throw new Error("Buffered document upload request envelope exceeds the safe integer range");
  }
  return maxPayloadBytes + overhead;
}

/**
 * Conservative retained-byte charge for bounded chunks, Hono body/FormData caches, and the
 * handler's File.arrayBuffer copy. This is an admission estimate, not an RSS accounting claim.
 */
export function bufferedDocumentUploadReservationBytes(
  maxPayloadBytes: number,
  maxFiles: number,
): number {
  const maxRequestBytes = bufferedDocumentUploadMaxRequestBytes(maxPayloadBytes, maxFiles);
  if (maxRequestBytes > Math.floor(Number.MAX_SAFE_INTEGER / 3)) {
    throw new Error("Buffered document upload reservation exceeds the safe integer range");
  }
  return maxRequestBytes * 3;
}

/**
 * Installs path-specific admission before OpenAPI's multipart form validator. The middleware
 * performs a bounded stream read and seeds Hono's body cache, so the validator can never call the
 * unbounded Request.arrayBuffer() path for these routes.
 */
export function registerBufferedDocumentUploadMiddleware(input: {
  readonly admission: BufferedDocumentUploadAdmission;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly maxBulkUploadBytes: number;
  readonly maxBulkUploadFiles: number;
  readonly bodyIdleTimeoutMs?: number | undefined;
  readonly bodyTotalTimeoutMs?: number | undefined;
  readonly maxUploadBytes: number;
}): void {
  const bodyIdleTimeoutMs = positiveSafeInteger(
    input.bodyIdleTimeoutMs ?? DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
    "bodyIdleTimeoutMs",
  );
  const bodyTotalTimeoutMs = positiveSafeInteger(
    input.bodyTotalTimeoutMs ?? DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
    "bodyTotalTimeoutMs",
  );
  registerRoute({
    admission: input.admission,
    app: input.app,
    bodyIdleTimeoutMs,
    bodyTotalTimeoutMs,
    maxRequestBytes: bufferedDocumentUploadMaxRequestBytes(input.maxUploadBytes, 1),
    path: "/knowledge-spaces/:id/documents",
    reservedBytes: bufferedDocumentUploadReservationBytes(input.maxUploadBytes, 1),
  });
  registerRoute({
    admission: input.admission,
    app: input.app,
    bodyIdleTimeoutMs,
    bodyTotalTimeoutMs,
    maxRequestBytes: bufferedDocumentUploadMaxRequestBytes(
      input.maxBulkUploadBytes,
      input.maxBulkUploadFiles,
    ),
    path: "/knowledge-spaces/:id/documents/bulk",
    reservedBytes: bufferedDocumentUploadReservationBytes(
      input.maxBulkUploadBytes,
      input.maxBulkUploadFiles,
    ),
  });
}

function registerRoute(input: {
  readonly admission: BufferedDocumentUploadAdmission;
  readonly app: OpenAPIHono<KnowledgeGatewayEnv>;
  readonly bodyIdleTimeoutMs: number;
  readonly bodyTotalTimeoutMs: number;
  readonly maxRequestBytes: number;
  readonly path: string;
  readonly reservedBytes: number;
}): void {
  input.app.use(input.path, async (context, next) => {
    if (context.req.method !== "POST") return next();

    try {
      assertDeclaredContentLength(context.req.raw, input.maxRequestBytes);
      await input.admission.run(
        async () => {
          const body = await readRequestBodyBounded(context.req.raw, input.maxRequestBytes, {
            idleTimeoutMs: input.bodyIdleTimeoutMs,
            totalTimeoutMs: input.bodyTotalTimeoutMs,
          });
          context.req.bodyCache.arrayBuffer = body.buffer;
          await next();
        },
        {
          // A missing or dishonest Content-Length must not under-reserve the process budget.
          reservedBytes: input.reservedBytes,
          signal: context.req.raw.signal,
        },
      );
      return undefined;
    } catch (error) {
      if (error instanceof BufferedDocumentUploadRequestTooLargeError) {
        return context.json({ error: error.message }, 413);
      }
      if (error instanceof BufferedDocumentUploadContentLengthError) {
        return context.json({ error: error.message }, 400);
      }
      if (error instanceof BufferedDocumentUploadTimeoutError) {
        return context.json({ error: error.message }, 408);
      }
      throw error;
    }
  });
}

function assertDeclaredContentLength(request: Request, maxRequestBytes: number): void {
  const value = request.headers.get("content-length");
  if (value === null) return;
  if (!/^\d+$/u.test(value)) throw new BufferedDocumentUploadContentLengthError();
  const declaredBytes = Number(value);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    throw new BufferedDocumentUploadContentLengthError();
  }
  if (declaredBytes > maxRequestBytes) {
    throw new BufferedDocumentUploadRequestTooLargeError(maxRequestBytes);
  }
}

async function readRequestBodyBounded(
  request: Request,
  maxRequestBytes: number,
  options: { readonly idleTimeoutMs: number; readonly totalTimeoutMs: number },
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const startedAt = Date.now();
  try {
    while (true) {
      const elapsedMs = Date.now() - startedAt;
      const remainingTotalMs = options.totalTimeoutMs - elapsedMs;
      if (remainingTotalMs <= 0) throw new BufferedDocumentUploadTimeoutError("total");
      const { done, value } = await readWithTimeout(
        reader,
        options.idleTimeoutMs,
        remainingTotalMs,
        request.signal,
      );
      if (done) break;
      if (totalBytes > maxRequestBytes - value.byteLength) {
        throw new BufferedDocumentUploadRequestTooLargeError(maxRequestBytes);
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readWithTimeout(
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
          reject(new BufferedDocumentUploadTimeoutError(timeoutKind));
        }, timeoutMs);
        timer.unref?.();
      }),
      new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(signal.reason);
        signal.addEventListener("abort", abortListener, { once: true });
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
    throw new Error(`Buffered document upload ${label} must be a positive safe integer`);
  }
  return value;
}
