import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type PluginDaemonClient,
  type PluginDaemonDatasourceInput,
  PluginDaemonError,
  createPluginDaemonClient,
} from "./index";

function sseStreamResponse(chunks: readonly string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
    ...init,
  });
}

function envelopeChunk(envelope: Record<string, unknown>): string {
  return `data: ${JSON.stringify(envelope)}\n\n`;
}

async function collect(
  client: PluginDaemonClient,
  input: PluginDaemonDatasourceInput = BASE_INPUT,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of client.dispatchDatasourceStream(input)) {
    values.push(value);
  }
  return values;
}

const OPTIONS = {
  apiKey: "plugin-api-key",
  baseUrl: "http://plugin-daemon:5002/",
} as const;

const BASE_INPUT = {
  data: { credentials: {}, provider: "firecrawl" },
  method: "get_website_crawl",
  pluginId: "langgenius/firecrawl_datasource",
  tenantId: "tenant-abc",
} as const satisfies PluginDaemonDatasourceInput;

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin-daemon datasource client", () => {
  it("uses the datasource-only path, headers, body, and streams every envelope", async () => {
    const calls: { init: RequestInit; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });
      return sseStreamResponse([
        envelopeChunk({ code: 0, data: { source_url: "https://a" }, message: "" }),
        envelopeChunk({ code: 0, data: { source_url: "https://b" }, message: "" }),
      ]);
    }) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(collect(client, { ...BASE_INPUT, userId: "user-1" })).resolves.toEqual([
      { source_url: "https://a" },
      { source_url: "https://b" },
    ]);
    expect(calls[0]?.url).toBe(
      "http://plugin-daemon:5002/plugin/tenant-abc/dispatch/datasource/get_website_crawl",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("plugin-api-key");
    expect(headers["x-plugin-id"]).toBe("langgenius/firecrawl_datasource");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      data: BASE_INPUT.data,
      user_id: "user-1",
    });
    expect(calls[0]?.url).not.toContain("/invoke");
  });

  it("accepts bare envelope lines", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse(['{"code":0,"message":"","data":{"value":42}}\n']),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).resolves.toEqual([{ value: 42 }]);
  });

  it("buffers an envelope split across chunks", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse(['data: {"code":0,"message":"",', '"data":{"value":42}}\n\n']),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).resolves.toEqual([{ value: 42 }]);
  });

  it("parses a final event without a trailing newline", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse(['data: {"code":0,"message":"","data":{"tail":1}}']),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).resolves.toEqual([{ tail: 1 }]);
  });

  it.each([null, undefined])("rejects an empty success payload: %s", async (data) => {
    const envelope = data === undefined ? { code: 0, message: "" } : { code: 0, data, message: "" };
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse([envelopeChunk(envelope)]),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
      name: "PluginDaemonError",
    });
  });

  it("unwraps nested daemon errors and redacts datasource credentials", async () => {
    const secret = "datasource-secret/?=";
    const shared = { token: secret };
    const message = JSON.stringify({
      error_type: "PluginInvokeError",
      message: JSON.stringify({
        error_type: `CredentialsValidateFailedError:${secret}`,
        message: `credential ${encodeURIComponent(secret)} is invalid`,
      }),
    });
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse([envelopeChunk({ code: -500, data: null, message })]),
      ) as unknown as typeof fetch,
    });
    const error = await collect(client, {
      ...BASE_INPUT,
      data: { credentials: { repeated: shared, token: secret, values: [shared] } },
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect(error).toMatchObject({
      code: "plugin_daemon_invoke",
      daemonCode: -500,
      errorType: "CredentialsValidateFailedError:[REDACTED]",
    });
    expect((error as Error).message).toContain("[REDACTED]");
    expect(JSON.stringify(error)).not.toContain(secret);
    expect((error as Error).message).not.toContain(encodeURIComponent(secret));
  });

  it("uses the daemon code when an error has no message", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse([envelopeChunk({ code: 7, data: null })]),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).rejects.toMatchObject({
      code: "plugin_daemon_invoke",
      daemonCode: 7,
      message: "Plugin daemon error code 7",
    });
  });

  it("passes through a plain daemon error message", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse([envelopeChunk({ code: 7, data: null, message: "plain failure text" })]),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).rejects.toMatchObject({
      daemonCode: 7,
      message: "plain failure text",
    });
  });

  it("enforces a deadline when fetch ignores AbortSignal", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | null = null;
    const client = createPluginDaemonClient({
      ...OPTIONS,
      dispatchRequestTimeoutMs: 25,
      fetch: vi.fn((_url: string, init: RequestInit) => {
        observedSignal = init.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }) as unknown as typeof fetch,
    });
    const request = collect(client);
    const expectation = expect(request).rejects.toMatchObject({ code: "plugin_daemon_timeout" });

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
    expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("enforces a deadline when the response reader ignores abort", async () => {
    vi.useFakeTimers();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Intentionally never enqueue or close.
        },
      }),
      { status: 200 },
    );
    const client = createPluginDaemonClient({
      ...OPTIONS,
      dispatchRequestTimeoutMs: 25,
      fetch: vi.fn(async () => response) as unknown as typeof fetch,
    });
    const next = client.dispatchDatasourceStream(BASE_INPUT).next();
    const expectation = expect(next).rejects.toMatchObject({ code: "plugin_daemon_timeout" });

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it("classifies caller abort even when fetch ignores AbortSignal", async () => {
    const controller = new AbortController();
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
    });
    const request = collect(client, { ...BASE_INPUT, signal: controller.signal });

    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
  });

  it("rejects a pre-aborted request without I/O", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      collect(client, { ...BASE_INPUT, signal: controller.signal }),
    ).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes transport errors without echoing credentials", async () => {
    const secret = "transport-secret-must-not-leak";
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => {
        throw new Error(`adapter echoed ${secret}`);
      }) as unknown as typeof fetch,
    });
    const error = await collect(client, {
      ...BASE_INPUT,
      data: { credentials: { api_key: secret } },
    }).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: "plugin_daemon_request_failed",
      message: "Plugin daemon request failed",
    });
    expect((error as Error).message).not.toContain(secret);
  });

  it.each([
    { code: "plugin_daemon_rate_limited", status: 429 },
    { code: "plugin_daemon_request_failed", status: 503 },
  ])("maps HTTP $status to $code", async ({ code, status }) => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => new Response("", { status })) as unknown as typeof fetch,
    });

    await expect(collect(client)).rejects.toMatchObject({ code, status });
  });

  it("retries retryable responses and cancels their bodies", async () => {
    let attempt = 0;
    let cancelled = false;
    const retryBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const sleep = vi.fn(async () => undefined);
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => {
        attempt += 1;
        return attempt === 1
          ? new Response(retryBody, { status: 503 })
          : sseStreamResponse([envelopeChunk({ code: 0, data: { ok: true }, message: "" })]);
      }) as unknown as typeof fetch,
      maxRetries: 1,
      retryDelayMs: 1,
      sleep,
    });

    await expect(collect(client)).resolves.toEqual([{ ok: true }]);
    expect(attempt).toBe(2);
    expect(cancelled).toBe(true);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it("supports a zero retry delay with the default sleeper", async () => {
    let attempt = 0;
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => {
        attempt += 1;
        return attempt === 1
          ? new Response("", { status: 408 })
          : sseStreamResponse([envelopeChunk({ code: 0, data: { ok: true }, message: "" })]);
      }) as unknown as typeof fetch,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    await expect(collect(client)).resolves.toEqual([{ ok: true }]);
  });

  it("enforces the streaming response byte cap", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse([envelopeChunk({ code: 0, data: { big: "x".repeat(64) }, message: "" })]),
      ) as unknown as typeof fetch,
      maxResponseBytes: 8,
    });

    await expect(collect(client)).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
    });
  });

  it("reads bodyless responses and enforces declared and actual byte limits", async () => {
    const bodyless = (body: string, contentLength?: string): Response =>
      ({
        body: null,
        headers: new Headers(contentLength ? { "content-length": contentLength } : {}),
        ok: true,
        status: 200,
        text: async () => body,
      }) as unknown as Response;
    const success = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        bodyless(envelopeChunk({ code: 0, data: { ok: true }, message: "" })),
      ) as unknown as typeof fetch,
    });
    await expect(collect(success)).resolves.toEqual([{ ok: true }]);

    const declared = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => bodyless("{}", "1024")) as unknown as typeof fetch,
      maxResponseBytes: 16,
    });
    await expect(collect(declared)).rejects.toThrow("maxResponseBytes=16");

    const actual = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => bodyless("x".repeat(32))) as unknown as typeof fetch,
      maxResponseBytes: 16,
    });
    await expect(collect(actual)).rejects.toThrow("maxResponseBytes=16");
  });

  it("ignores keep-alive and blank lines", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () =>
        sseStreamResponse(["\n\n", "data:   \n", "  \n"]),
      ) as unknown as typeof fetch,
    });

    await expect(collect(client)).resolves.toEqual([]);
  });

  it.each([
    { body: "data: not-json\n", label: "invalid JSON" },
    { body: envelopeChunk({ data: { unexpected: true } }), label: "invalid envelope" },
  ])("rejects $label", async ({ body }) => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => sseStreamResponse([body])) as unknown as typeof fetch,
    });

    await expect(collect(client)).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
    });
  });

  it.each([
    { label: "array root", value: [] },
    { label: "non-finite number", value: { score: Number.NaN } },
    { label: "non-JSON object", value: { createdAt: new Date() } },
  ])("rejects $label dispatch data before I/O", async ({ value }) => {
    const fetchImpl = vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      collect(client, { ...BASE_INPUT, data: value as Record<string, unknown> }),
    ).rejects.toMatchObject({ code: "plugin_daemon_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects circular and over-deep dispatch data", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(collect(client, { ...BASE_INPUT, data: circular })).rejects.toThrow(
      "circular references",
    );

    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 26; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    await expect(collect(client, { ...BASE_INPUT, data: root })).rejects.toThrow(
      "complexity limits",
    );
  });

  it("validates constructor bounds and dispatch identifiers", async () => {
    expect(() => createPluginDaemonClient({ apiKey: "k", baseUrl: "  " })).toThrow("baseUrl");
    expect(() => createPluginDaemonClient({ apiKey: "  ", baseUrl: "http://x" })).toThrow("apiKey");
    expect(() => createPluginDaemonClient({ ...OPTIONS, maxResponseBytes: 0 })).toThrow(
      "maxResponseBytes",
    );
    expect(() => createPluginDaemonClient({ ...OPTIONS, maxRetries: -1 })).toThrow("maxRetries");
    expect(() => createPluginDaemonClient({ ...OPTIONS, dispatchRequestTimeoutMs: 0 })).toThrow(
      "dispatchRequestTimeoutMs",
    );
    expect(() =>
      createPluginDaemonClient({ ...OPTIONS, dispatchRequestTimeoutMs: 600_001 }),
    ).toThrow("dispatchRequestTimeoutMs");

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch,
    });
    await expect(collect(client, { ...BASE_INPUT, tenantId: "  " })).rejects.toThrow("tenantId");
    await expect(collect(client, { ...BASE_INPUT, pluginId: "  " })).rejects.toThrow("pluginId");
  });
});
