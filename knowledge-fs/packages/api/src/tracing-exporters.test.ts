import { describe, expect, it } from "vitest";

import { createConsoleTraceRecorder, createOtlpTraceRecorder } from "./tracing-exporters";

describe("createConsoleTraceRecorder", () => {
  it("logs one structured line per finished span with merged attributes and duration", () => {
    const lines: string[] = [];
    let clock = 1_000;
    const recorder = createConsoleTraceRecorder({
      log: (line) => lines.push(line),
      now: () => clock,
    });

    const span = recorder.startSpan("retrieval.plan", { requestedMode: "deep" });
    clock = 1_250;
    span.end("ok", { resolvedMode: "deep" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      attributes: { requestedMode: "deep", resolvedMode: "deep" },
      durationMs: 250,
      kind: "trace-span",
      name: "retrieval.plan",
      status: "ok",
    });
  });
});

describe("createOtlpTraceRecorder", () => {
  function fakeFetch() {
    const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
    const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        headers: (init?.headers ?? {}) as Record<string, string>,
        url: String(url),
      });

      return new Response(null, { status: 200 });
    }) as typeof fetch;

    return { impl, requests };
  }

  it("exports buffered spans as an OTLP/HTTP JSON batch", async () => {
    const { impl, requests } = fakeFetch();
    let clock = 1_700_000_000_000;
    const recorder = createOtlpTraceRecorder({
      endpoint: "http://collector:4318/v1/traces",
      fetchImpl: impl,
      headers: { authorization: "Bearer token-1" },
      now: () => clock,
      serviceName: "knowledge-fs-api",
    });

    const span = recorder.startSpan("retrieval.plan", {
      requestedMode: "deep",
      skipped: false,
      topK: 10,
    });
    clock += 42;
    span.end("ok");
    await recorder.stop();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://collector:4318/v1/traces");
    expect(requests[0]?.headers).toMatchObject({
      authorization: "Bearer token-1",
      "content-type": "application/json",
    });

    const payload = requests[0]?.body as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
        scopeSpans: Array<{ spans: Array<Record<string, unknown>> }>;
      }>;
    };
    expect(payload.resourceSpans[0]?.resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "knowledge-fs-api" } },
    ]);
    const exported = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(exported).toMatchObject({
      endTimeUnixNano: "1700000000042000000",
      kind: 1,
      name: "retrieval.plan",
      startTimeUnixNano: "1700000000000000000",
      status: { code: 1 },
    });
    expect(exported?.attributes).toEqual([
      { key: "requestedMode", value: { stringValue: "deep" } },
      { key: "skipped", value: { boolValue: false } },
      { key: "topK", value: { intValue: "10" } },
    ]);
    expect(String(exported?.traceId)).toMatch(/^[0-9a-f]{32}$/u);
    expect(String(exported?.spanId)).toMatch(/^[0-9a-f]{16}$/u);
  });

  it("marks errored spans, drops beyond the buffer cap, and reports export failures", async () => {
    const errors: unknown[] = [];
    const { impl, requests } = fakeFetch();
    const recorder = createOtlpTraceRecorder({
      endpoint: "http://collector:4318/v1/traces",
      fetchImpl: impl,
      maxBufferedSpans: 1,
      onExportError: (error) => errors.push(error),
      serviceName: "svc",
    });

    recorder.startSpan("a", {}).end("error");
    recorder.startSpan("b", {}).end("ok"); // over cap -> dropped + reported once
    recorder.startSpan("c", {}).end("ok");
    await recorder.flush();

    expect(errors).toHaveLength(1);
    const payload = requests[0]?.body as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<Record<string, unknown>> }> }>;
    };
    const spans = payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ name: "a", status: { code: 2 } });

    // Failed POSTs surface through onExportError instead of throwing.
    const failing = createOtlpTraceRecorder({
      endpoint: "http://collector:4318/v1/traces",
      fetchImpl: (async () => new Response(null, { status: 503 })) as typeof fetch,
      onExportError: (error) => errors.push(error),
      serviceName: "svc",
    });
    failing.startSpan("d", {}).end("ok");
    await failing.stop();
    expect(errors).toHaveLength(2);
  });

  it("rejects invalid configuration", () => {
    expect(() => createOtlpTraceRecorder({ endpoint: "  ", serviceName: "svc" })).toThrow(
      "endpoint is required",
    );
    expect(() =>
      createOtlpTraceRecorder({
        endpoint: "http://collector:4318/v1/traces",
        flushIntervalMs: 10,
        serviceName: "svc",
      }),
    ).toThrow("flushIntervalMs must be at least 100");
  });
});
