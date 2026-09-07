import { afterEach, describe, expect, it, vi } from "vitest";

import { isPdfRasterLimitResponse } from "./unstructured-response-safety";

const guardDetail =
  "PDF page would render to too many pixels for safe processing: " +
  "page=1, pixels=273439296, maximum=25000000. " +
  "Try splitting the PDF, reducing the page dimensions, or using a lower render DPI.";

afterEach(() => {
  vi.useRealTimers();
});

describe("Unstructured PDF raster-limit responses", () => {
  it.each([500, 422])("recognizes the exact provider guard in HTTP %s", async (status) => {
    const response = Response.json({ detail: guardDetail }, { status });
    await expect(isPdfRasterLimitResponse(response, new AbortController().signal)).resolves.toBe(
      true,
    );
    expect(response.body?.locked).toBe(false);
  });

  it.each([
    null,
    { error: guardDetail },
    { detail: null },
    { detail: "Internal server error" },
    { detail: `${guardDetail} More untrusted text` },
    { detail: guardDetail.replace("273439296", "1") },
    { detail: guardDetail.replace("page=1", "page=0") },
    { detail: guardDetail.replace("maximum=25000000", "maximum=0") },
    { detail: guardDetail.replace("273439296", "9007199254740999") },
  ])("keeps unknown errors in their original HTTP status class: %j", async (payload) => {
    await expect(
      isPdfRasterLimitResponse(
        Response.json(payload, { status: 500 }),
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it("does not recognize malformed JSON", async () => {
    await expect(
      isPdfRasterLimitResponse(
        new Response("{bad-json", { status: 500 }),
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });

  it("handles a missing error body", async () => {
    await expect(
      isPdfRasterLimitResponse(new Response(null, { status: 500 }), new AbortController().signal),
    ).resolves.toBe(false);
  });

  it("leaves an already-locked response body with its current owner", async () => {
    const response = Response.json({ detail: guardDetail }, { status: 500 });
    const reader = response.body?.getReader();
    await expect(isPdfRasterLimitResponse(response, new AbortController().signal)).resolves.toBe(
      false,
    );
    expect(response.body?.locked).toBe(true);
    reader?.releaseLock();
  });

  it("accepts a complete streamed error at the 4 KiB limit", async () => {
    const payload = new TextEncoder().encode(JSON.stringify({ detail: guardDetail }).padEnd(4096));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(payload.subarray(0, 100));
        controller.enqueue(payload.subarray(100));
        controller.close();
      },
    });
    await expect(
      isPdfRasterLimitResponse(new Response(body, { status: 500 }), new AbortController().signal),
    ).resolves.toBe(true);
  });

  it("bounds the sum of streamed chunks and ignores a rejected cancellation", async () => {
    const cancel = vi.fn(async () => {
      throw new Error("connection already closed");
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.enqueue(new Uint8Array(2049));
      },
      cancel,
    });
    await expect(
      isPdfRasterLimitResponse(new Response(body, { status: 500 }), new AbortController().signal),
    ).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("does not read ordinary HTTP 429 responses", async () => {
    const pull = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    await expect(
      isPdfRasterLimitResponse(new Response(body, { status: 429 }), new AbortController().signal),
    ).resolves.toBe(false);
    expect(pull).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("stops at 4 KiB and cancels oversized error bodies", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    await expect(
      isPdfRasterLimitResponse(new Response(body, { status: 500 }), new AbortController().signal),
    ).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("bounds a stalled error-body inspection to one second even if cancellation stalls", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const result = isPdfRasterLimitResponse(
      new Response(body, { status: 500 }),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves parent cancellation and releases the response reader", async () => {
    const controller = new AbortController();
    const reason = new Error("parser lease expired");
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const result = isPdfRasterLimitResponse(new Response(body, { status: 500 }), controller.signal);
    const rejected = expect(result).rejects.toBe(reason);
    controller.abort(reason);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it("preserves an already-aborted parent's reason without locking the stream", async () => {
    const controller = new AbortController();
    const reason = new Error("already cancelled");
    controller.abort(reason);
    const response = Response.json({ detail: guardDetail }, { status: 500 });
    await expect(isPdfRasterLimitResponse(response, controller.signal)).rejects.toBe(reason);
    expect(response.body?.locked).toBe(false);
  });

  it("preserves the HTTP classification when the response body itself fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection closed"));
      },
    });
    await expect(
      isPdfRasterLimitResponse(new Response(body, { status: 500 }), new AbortController().signal),
    ).resolves.toBe(false);
    expect(body.locked).toBe(false);
  });
});
