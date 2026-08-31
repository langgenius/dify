import { describe, expect, it } from "vitest";

import { createBufferedDocumentUploadAdmission } from "./buffered-document-upload-admission";
import {
  bufferedDocumentUploadMaxRequestBytes,
  bufferedDocumentUploadReservationBytes,
  registerBufferedDocumentUploadMiddleware,
} from "./buffered-document-upload-middleware";
import { bulkUploadDocumentsRoute, uploadDocumentRoute } from "./document-write-routes";
import { createKnowledgeGatewayApp } from "./gateway-app";

describe("buffered document upload middleware", () => {
  it("queues a bulk request before OpenAPI can consume its body while a single upload is active", async () => {
    const maxUploadBytes = 16;
    const maxBulkUploadBytes = 32;
    const maxBulkUploadFiles = 2;
    const admission = createBufferedDocumentUploadAdmission({
      maxConcurrency: 1,
      maxReservedBytes: bufferedDocumentUploadReservationBytes(
        maxBulkUploadBytes,
        maxBulkUploadFiles,
      ),
    });
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission,
      app,
      maxBulkUploadBytes,
      maxBulkUploadFiles,
      maxUploadBytes,
    });
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let bulkHandlerCalls = 0;
    app.openapi(uploadDocumentRoute, async (context) => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return context.json({} as never, 201);
    });
    app.openapi(bulkUploadDocumentsRoute, async (context) => {
      bulkHandlerCalls += 1;
      return context.json({} as never, 202);
    });

    const single = await multipartRequest(`/knowledge-spaces/${SPACE_ID}/documents`, "file");
    const bulk = await multipartRequest(`/knowledge-spaces/${SPACE_ID}/documents/bulk`, "files");
    const firstResponse = app.fetch(single);
    await firstEntered.promise;
    const secondResponse = app.fetch(bulk);
    await Promise.resolve();
    await Promise.resolve();

    expect(single.bodyReads).toBeGreaterThan(0);
    expect(bulk.bodyReads).toBe(0);
    expect(bulkHandlerCalls).toBe(0);

    releaseFirst.resolve();
    await expect(firstResponse).resolves.toMatchObject({ status: 201 });
    await expect(secondResponse).resolves.toMatchObject({ status: 202 });
    expect(bulk.bodyReads).toBeGreaterThan(0);
    expect(bulkHandlerCalls).toBe(1);
  });

  it("rejects a declared oversized request before reading or validating multipart data", async () => {
    const maxUploadBytes = 4;
    const maxRequestBytes = bufferedDocumentUploadMaxRequestBytes(maxUploadBytes, 1);
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission: createBufferedDocumentUploadAdmission({
        maxConcurrency: 1,
        maxReservedBytes: maxRequestBytes * 3,
      }),
      app,
      maxBulkUploadBytes: 8,
      maxBulkUploadFiles: 2,
      maxUploadBytes,
    });
    let handlerCalls = 0;
    app.openapi(uploadDocumentRoute, async (context) => {
      handlerCalls += 1;
      return context.json({} as never, 201);
    });
    const request = await multipartRequest(`/knowledge-spaces/${SPACE_ID}/documents`, "file", {
      contentLength: maxRequestBytes + 1,
    });

    const response = await app.fetch(request);

    expect(response.status).toBe(413);
    expect(request.bodyReads).toBe(0);
    expect(handlerCalls).toBe(0);
  });

  it("bounds a missing-Content-Length stream before OpenAPI's arrayBuffer validator", async () => {
    const maxUploadBytes = 4;
    const maxRequestBytes = bufferedDocumentUploadMaxRequestBytes(maxUploadBytes, 1);
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission: createBufferedDocumentUploadAdmission({
        maxConcurrency: 1,
        maxReservedBytes: maxRequestBytes * 3,
      }),
      app,
      maxBulkUploadBytes: 8,
      maxBulkUploadFiles: 2,
      maxUploadBytes,
    });
    let handlerCalls = 0;
    app.openapi(uploadDocumentRoute, async (context) => {
      handlerCalls += 1;
      return context.json({} as never, 201);
    });
    const request = new ObservedRequest(`http://localhost/knowledge-spaces/${SPACE_ID}/documents`, {
      body: new Uint8Array(maxRequestBytes + 1),
      headers: { "content-type": "multipart/form-data; boundary=bounded-test" },
      method: "POST",
    });

    const response = await app.fetch(request);

    expect(response.status).toBe(413);
    expect(request.bodyReads).toBeGreaterThan(0);
    expect(handlerCalls).toBe(0);
  });

  it("times out stalled readers, releases both slots, and admits the next upload", async () => {
    const maxUploadBytes = 16;
    const reservationBytes = bufferedDocumentUploadReservationBytes(maxUploadBytes, 1);
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission: createBufferedDocumentUploadAdmission({
        maxConcurrency: 2,
        maxReservedBytes: reservationBytes * 2,
      }),
      app,
      bodyIdleTimeoutMs: 20,
      bodyTotalTimeoutMs: 1_000,
      maxBulkUploadBytes: 32,
      maxBulkUploadFiles: 2,
      maxUploadBytes,
    });
    let handlerCalls = 0;
    app.openapi(uploadDocumentRoute, async (context) => {
      handlerCalls += 1;
      return context.json({} as never, 201);
    });
    const path = `/knowledge-spaces/${SPACE_ID}/documents`;
    const first = stalledMultipartRequest(path);
    const second = stalledMultipartRequest(path);
    const firstResponse = app.fetch(first);
    const secondResponse = app.fetch(second);
    await waitFor(() => first.bodyReads > 0 && second.bodyReads > 0);
    const third = await multipartRequest(path, "file");
    const thirdResponse = app.fetch(third);

    await expect(firstResponse).resolves.toMatchObject({ status: 408 });
    await expect(secondResponse).resolves.toMatchObject({ status: 408 });
    await expect(thirdResponse).resolves.toMatchObject({ status: 201 });
    expect(handlerCalls).toBe(1);
  });

  it("applies a total body deadline independently from the idle timeout", async () => {
    const maxUploadBytes = 16;
    const reservationBytes = bufferedDocumentUploadReservationBytes(maxUploadBytes, 1);
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission: createBufferedDocumentUploadAdmission({
        maxConcurrency: 1,
        maxReservedBytes: reservationBytes,
      }),
      app,
      bodyIdleTimeoutMs: 1_000,
      bodyTotalTimeoutMs: 20,
      maxBulkUploadBytes: 32,
      maxBulkUploadFiles: 2,
      maxUploadBytes,
    });
    app.openapi(uploadDocumentRoute, async (context) => context.json({} as never, 201));

    const response = await app.fetch(
      stalledMultipartRequest(`/knowledge-spaces/${SPACE_ID}/documents`),
    );

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({
      error: "Buffered document upload total timeout",
    });
  });

  it("cancels an active stalled reader and releases its admission slot", async () => {
    const maxUploadBytes = 16;
    const reservationBytes = bufferedDocumentUploadReservationBytes(maxUploadBytes, 1);
    const app = createKnowledgeGatewayApp();
    registerBufferedDocumentUploadMiddleware({
      admission: createBufferedDocumentUploadAdmission({
        maxConcurrency: 1,
        maxReservedBytes: reservationBytes,
      }),
      app,
      bodyIdleTimeoutMs: 60_000,
      bodyTotalTimeoutMs: 60_000,
      maxBulkUploadBytes: 32,
      maxBulkUploadFiles: 2,
      maxUploadBytes,
    });
    let handlerCalls = 0;
    app.openapi(uploadDocumentRoute, async (context) => {
      handlerCalls += 1;
      return context.json({} as never, 201);
    });
    const path = `/knowledge-spaces/${SPACE_ID}/documents`;
    const controller = new AbortController();
    const stalled = stalledMultipartRequest(path, controller.signal);
    const abortedResponse = app.fetch(stalled);
    await waitFor(() => stalled.bodyReads > 0);
    controller.abort(new Error("client disconnected"));
    const accepted = await multipartRequest(path, "file");
    const acceptedResponse = app.fetch(accepted);

    const [aborted, succeeded] = await Promise.all([abortedResponse, acceptedResponse]);
    expect(aborted.status).toBe(500);
    expect(succeeded.status).toBe(201);
    expect(handlerCalls).toBe(1);
  });
});

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

class ObservedRequest extends Request {
  bodyReads = 0;

  override get body(): Request["body"] {
    this.bodyReads += 1;
    return super.body;
  }
}

async function multipartRequest(
  path: string,
  field: "file" | "files",
  options: { readonly contentLength?: number } = {},
): Promise<ObservedRequest> {
  const form = new FormData();
  form.set(field, new File([new Uint8Array([1, 2, 3])], "test.md", { type: "text/markdown" }));
  const seed = new Request(`http://localhost${path}`, { body: form, method: "POST" });
  const contentType = seed.headers.get("content-type");
  if (!contentType) throw new Error("Expected generated multipart Content-Type");
  const body = await seed.arrayBuffer();
  return new ObservedRequest(`http://localhost${path}`, {
    body,
    headers: {
      "content-type": contentType,
      ...(options.contentLength === undefined
        ? {}
        : { "content-length": String(options.contentLength) }),
    },
    method: "POST",
  });
}

function stalledMultipartRequest(path: string, signal?: AbortSignal): ObservedRequest {
  const stream = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
  });
  return new ObservedRequest(`http://localhost${path}`, {
    body: stream,
    // Node requires duplex for streaming request bodies; it is not part of the browser RequestInit.
    duplex: "half",
    headers: { "content-type": "multipart/form-data; boundary=stalled-test" },
    method: "POST",
    ...(signal ? { signal } : {}),
  } as RequestInit & { readonly duplex: "half" });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for upload body consumption");
}
