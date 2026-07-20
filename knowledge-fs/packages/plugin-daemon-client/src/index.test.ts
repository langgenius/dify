import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginDaemonError, createPluginDaemonClient } from "./index";

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

const OPTIONS = {
  apiKey: "plugin-api-key",
  baseUrl: "http://plugin-daemon:5002/",
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("createPluginDaemonClient", () => {
  it("dispatches a unary embedding call with the tenant-scoped URL, headers, and envelope", async () => {
    const calls: { init: RequestInit; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });

      return sseStreamResponse([
        envelopeChunk({
          code: 0,
          data: { embeddings: [[0.1, 0.2]], model: "text-embedding-3-large" },
          message: "",
        }),
      ]);
    }) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const result = await client.dispatchUnary({
      data: { model: "text-embedding-3-large", texts: ["hello"] },
      op: "text_embedding",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
      userId: "user-1",
    });

    expect(result).toEqual({ embeddings: [[0.1, 0.2]], model: "text-embedding-3-large" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://plugin-daemon:5002/plugin/tenant-abc/dispatch/text_embedding/invoke",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("plugin-api-key");
    expect(headers["x-plugin-id"]).toBe("langgenius/openai");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      data: { model: "text-embedding-3-large", texts: ["hello"] },
      user_id: "user-1",
    });
  });

  it("accepts bare JSON envelope lines without a data: prefix (dify line semantics)", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse(['{"code":0,"message":"","data":{"value":42}}\n']),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const result = await client.dispatchUnary({
      data: {},
      op: "text_embedding",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
    });

    expect(result).toEqual({ value: 42 });
  });

  it("buffers an envelope line split across stream chunks", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse(['data: {"code":0,"message":"",', '"data":{"value":42}}\n\n']),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const result = await client.dispatchUnary({
      data: {},
      op: "text_embedding",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
    });

    expect(result).toEqual({ value: 42 });
  });

  it("rejects a success envelope with an empty data payload (dify raises on empty data)", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([envelopeChunk({ code: 0, data: null, message: "" })]),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
      name: "PluginDaemonError",
    });
  });

  it("streams every envelope data payload in order for the llm op", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([
        envelopeChunk({ code: 0, data: { delta: { message: { content: "Hel" } } }, message: "" }),
        envelopeChunk({ code: 0, data: { delta: { message: { content: "lo" } } }, message: "" }),
      ]),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const chunks: unknown[] = [];

    for await (const data of client.dispatchStream({
      data: {},
      op: "llm",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
    })) {
      chunks.push(data);
    }

    expect(chunks).toEqual([
      { delta: { message: { content: "Hel" } } },
      { delta: { message: { content: "lo" } } },
    ]);
  });

  it("dispatches a datasource method to dispatch/datasource/{method} (no /invoke) and streams pages", async () => {
    const calls: { init: RequestInit; url: string }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });

      return sseStreamResponse([
        envelopeChunk({ code: 0, data: { result: { source_url: "https://a" } }, message: "" }),
        envelopeChunk({ code: 0, data: { result: { source_url: "https://b" } }, message: "" }),
      ]);
    }) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const pages: unknown[] = [];

    for await (const data of client.dispatchDatasourceStream({
      data: { credentials: {}, datasource: "crawler", provider: "firecrawl" },
      method: "get_website_crawl",
      pluginId: "langgenius/firecrawl_datasource",
      tenantId: "tenant-abc",
      userId: "user-1",
    })) {
      pages.push(data);
    }

    expect(calls[0]?.url).toBe(
      "http://plugin-daemon:5002/plugin/tenant-abc/dispatch/datasource/get_website_crawl",
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("plugin-api-key");
    expect(headers["x-plugin-id"]).toBe("langgenius/firecrawl_datasource");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      data: { credentials: {}, datasource: "crawler", provider: "firecrawl" },
      user_id: "user-1",
    });
    expect(pages).toEqual([
      { result: { source_url: "https://a" } },
      { result: { source_url: "https://b" } },
    ]);
  });

  it("throws a PluginDaemonError that unwraps nested PluginInvokeError envelopes", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([
        envelopeChunk({
          code: -500,
          data: null,
          message: JSON.stringify({
            error_type: "PluginInvokeError",
            message: JSON.stringify({
              error_type: "InvokeAuthorizationError",
              message: "Invalid API key",
            }),
          }),
        }),
      ]),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({
      code: "plugin_daemon_invoke",
      daemonCode: -500,
      errorType: "InvokeAuthorizationError",
      message: "Invalid API key",
    });
  });

  it.each([
    { label: "embedding unary", op: "text_embedding", streamed: false },
    { label: "rerank unary", op: "rerank", streamed: false },
    { label: "LLM stream", op: "llm", streamed: true },
  ] as const)("redacts nested dispatch credentials from $label daemon errors", async (fixture) => {
    const secret = `sk-${fixture.op}-must-not-leak/?=`;
    const sharedCredential = { api_key: secret };
    const credentials = Object.assign(Object.create(null) as Record<string, unknown>, {
      nested: sharedCredential,
      repeated: sharedCredential,
      values: [secret],
    });
    const daemonMessage = JSON.stringify({
      error_type: "PluginInvokeError",
      message: JSON.stringify({
        error_type: `CredentialsValidateFailedError:${secret}`,
        message: `credential ${encodeURIComponent(secret)} is invalid`,
      }),
    });
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([envelopeChunk({ code: -500, data: null, message: daemonMessage })]),
    ) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const input = {
      data: { credentials },
      op: fixture.op,
      pluginId: "langgenius/provider",
      tenantId: "tenant-abc",
    } as const;
    const request = fixture.streamed
      ? (async () => {
          for await (const _chunk of client.dispatchStream(input)) {
            // The fixture fails before yielding a successful chunk.
          }
        })()
      : client.dispatchUnary(input);
    const error = await request.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect((error as PluginDaemonError).errorType).toBe(
      "CredentialsValidateFailedError:[REDACTED]",
    );
    expect((error as PluginDaemonError).errorType).not.toContain(secret);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain(encodeURIComponent(secret));
  });

  it("redacts datasource stream credentials from daemon errors", async () => {
    const secret = "datasource-stream-secret";
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([
        envelopeChunk({
          code: -500,
          data: null,
          message: JSON.stringify({
            error_type: "CredentialsValidateFailedError",
            message: `credential ${secret} is invalid`,
          }),
        }),
      ]),
    ) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const request = (async () => {
      for await (const _chunk of client.dispatchDatasourceStream({
        data: { credentials: { token: secret }, provider: "example" },
        method: "get_website_crawl",
        pluginId: "langgenius/example",
        tenantId: "tenant-abc",
      })) {
        // The fixture fails before yielding a successful chunk.
      }
    })();
    const error = await request.catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(secret);
  });

  it.each(["text_embedding", "rerank"] as const)(
    "enforces a hard %s unary deadline when fetch ignores AbortSignal",
    async (op) => {
      vi.useFakeTimers();
      let observedSignal: AbortSignal | null = null;
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
        observedSignal = init.signal as AbortSignal;
        return new Promise<Response>(() => undefined);
      }) as unknown as typeof fetch;
      const client = createPluginDaemonClient({
        ...OPTIONS,
        dispatchRequestTimeoutMs: 25,
        fetch: fetchImpl,
      });
      const request = client.dispatchUnary({
        data: { credentials: { api_key: "not-logged" } },
        op,
        pluginId: "langgenius/provider",
        tenantId: "tenant-abc",
      });
      const expectation = expect(request).rejects.toMatchObject({
        code: "plugin_daemon_timeout",
        message: "Plugin daemon request timed out",
      });

      await vi.advanceTimersByTimeAsync(25);
      await expectation;
      expect((observedSignal as AbortSignal | null)?.aborted).toBe(true);
    },
  );

  it("enforces a hard LLM stream deadline when the response iterator ignores abort", async () => {
    vi.useFakeTimers();
    const stalledResponse = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Intentionally never enqueue or close.
        },
      }),
      { headers: { "content-type": "text/event-stream" }, status: 200 },
    );
    const client = createPluginDaemonClient({
      ...OPTIONS,
      dispatchRequestTimeoutMs: 25,
      fetch: (async () => stalledResponse) as unknown as typeof fetch,
    });
    const next = client
      .dispatchStream({ data: {}, op: "llm", pluginId: "p", tenantId: "t" })
      .next();
    const expectation = expect(next).rejects.toMatchObject({ code: "plugin_daemon_timeout" });

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it("classifies caller abort even when fetch ignores AbortSignal", async () => {
    const controller = new AbortController();
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
    });
    const request = client.dispatchUnary({
      data: {},
      op: "text_embedding",
      pluginId: "p",
      signal: controller.signal,
      tenantId: "t",
    });

    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
  });

  it("rejects an already-aborted dispatch without performing I/O", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "p",
        signal: controller.signal,
        tenantId: "t",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes dispatch transport errors without echoing credentials", async () => {
    const secret = "transport-secret-must-not-leak";
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => {
        throw new Error(`adapter echoed ${secret}`);
      }) as unknown as typeof fetch,
    });
    const error = await client
      .dispatchUnary({
        data: { credentials: { api_key: secret } },
        op: "text_embedding",
        pluginId: "p",
        tenantId: "t",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect(error).toMatchObject({
      code: "plugin_daemon_request_failed",
      message: "Plugin daemon request failed",
    });
    expect((error as Error).message).not.toContain(secret);
  });

  it("maps a 429 response to a rate-limited error and a 5xx to a request failure", async () => {
    const rateLimited = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => new Response("", { status: 429 })) as unknown as typeof fetch,
    });

    await expect(
      rateLimited.dispatchUnary({
        data: {},
        op: "rerank",
        pluginId: "langgenius/cohere",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_rate_limited", status: 429 });

    const serverError = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch,
    });

    await expect(
      serverError.dispatchUnary({
        data: {},
        op: "rerank",
        pluginId: "langgenius/cohere",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_request_failed", status: 503 });
  });

  it("retries retryable statuses up to maxRetries then succeeds", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;

      if (attempt === 1) {
        return new Response("", { status: 503 });
      }

      return sseStreamResponse([envelopeChunk({ code: 0, data: { ok: true }, message: "" })]);
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: fetchImpl,
      maxRetries: 1,
      sleep,
    });

    const result = await client.dispatchUnary({
      data: {},
      op: "llm",
      pluginId: "langgenius/openai",
      tenantId: "tenant-abc",
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("enforces the response byte cap", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([envelopeChunk({ code: 0, data: { big: "x".repeat(64) }, message: "" })]),
    ) as unknown as typeof fetch;

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: fetchImpl,
      maxResponseBytes: 8,
    });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("reads a non-streaming (bodyless) response and enforces content-length", async () => {
    const bodyless = {
      body: null,
      headers: new Headers(),
      ok: true,
      status: 200,
      text: async () => envelopeChunk({ code: 0, data: { ok: true }, message: "" }),
    } as unknown as Response;

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => bodyless) as unknown as typeof fetch,
    });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).resolves.toEqual({ ok: true });

    const oversizedHeaders = new Headers();
    oversizedHeaders.set("content-length", "1024");
    const oversized = {
      body: null,
      headers: oversizedHeaders,
      ok: true,
      status: 200,
      text: async () => envelopeChunk({ code: 0, data: {}, message: "" }),
    } as unknown as Response;

    const capped = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => oversized) as unknown as typeof fetch,
      maxResponseBytes: 16,
    });

    await expect(
      capped.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("throws when the daemon returns no data", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        sseStreamResponse([": keep-alive comment\n\n"])) as unknown as typeof fetch,
    });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("rejects malformed envelope JSON", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => sseStreamResponse(["data: not-json\n\n"])) as unknown as typeof fetch,
    });

    await expect(
      client.dispatchUnary({
        data: {},
        op: "text_embedding",
        pluginId: "langgenius/openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("rejects a structurally invalid daemon envelope", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        sseStreamResponse([
          envelopeChunk({ data: { unexpected: true } }),
        ])) as unknown as typeof fetch,
    });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("uses a stable fallback when a daemon error omits its message", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        sseStreamResponse([envelopeChunk({ code: 7, data: null })])) as unknown as typeof fetch,
    });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toMatchObject({
      code: "plugin_daemon_invoke",
      daemonCode: 7,
      message: "Plugin daemon error code 7",
    });
  });

  it("rejects circular dispatch data before performing I/O", async () => {
    const fetchImpl = vi.fn(async () => sseStreamResponse([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });
    const data: Record<string, unknown> = {};
    data.self = data;

    await expect(
      client.dispatchUnary({ data, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_input" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates constructor options and dispatch inputs", () => {
    expect(() => createPluginDaemonClient({ apiKey: "k", baseUrl: "  " })).toThrow(
      PluginDaemonError,
    );
    expect(() => createPluginDaemonClient({ apiKey: "  ", baseUrl: "http://x" })).toThrow(
      PluginDaemonError,
    );

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        sseStreamResponse([
          envelopeChunk({ code: 0, data: {}, message: "" }),
        ])) as unknown as typeof fetch,
    });

    return Promise.all([
      expect(
        client.dispatchUnary({
          data: {},
          op: "llm",
          pluginId: "langgenius/openai",
          tenantId: "   ",
        }),
      ).rejects.toMatchObject({ code: "plugin_daemon_input" }),
      expect(
        client.dispatchUnary({ data: {}, op: "llm", pluginId: "  ", tenantId: "tenant-abc" }),
      ).rejects.toMatchObject({ code: "plugin_daemon_input" }),
    ]);
  });

  it("validates constructor bounds and dispatch identifiers", async () => {
    expect(() => createPluginDaemonClient({ ...OPTIONS, maxResponseBytes: 0 })).toThrow(
      "maxResponseBytes must be at least 1",
    );
    expect(() => createPluginDaemonClient({ ...OPTIONS, maxRetries: -1 })).toThrow(
      "maxRetries must be at least 0",
    );
    expect(() => createPluginDaemonClient({ ...OPTIONS, dispatchRequestTimeoutMs: 0 })).toThrow(
      "dispatchRequestTimeoutMs",
    );
    expect(() =>
      createPluginDaemonClient({ ...OPTIONS, dispatchRequestTimeoutMs: 600_001 }),
    ).toThrow("dispatchRequestTimeoutMs");

    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => sseStreamResponse([])) as unknown as typeof fetch,
    });
    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "  ", tenantId: "t" }),
    ).rejects.toThrow("requires a pluginId");
  });

  it("rejects a stream that completes without any data events", async () => {
    const fetchImpl = vi.fn(async () => sseStreamResponse(["\n\n"])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toThrow("returned no data");
  });

  it("passes through non-JSON daemon error messages", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse([envelopeChunk({ code: 7, data: null, message: "plain failure text" })]),
    ) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toMatchObject({ daemonCode: 7, message: "plain failure text" });
  });

  it("retries retryable statuses with a delay before succeeding", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;

      if (attempt === 1) {
        return new Response("busy", { status: 503 });
      }

      return sseStreamResponse([envelopeChunk({ code: 0, data: { ok: true }, message: "" })]);
    }) as unknown as typeof fetch;
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: fetchImpl,
      maxRetries: 2,
      retryDelayMs: 1,
    });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).resolves.toEqual({ ok: true });
    expect(attempt).toBe(2);
  });

  it("parses a final SSE event that arrives without a trailing newline", async () => {
    const fetchImpl = vi.fn(async () =>
      sseStreamResponse(['data: {"code":0,"message":"","data":{"tail":1}}']),
    ) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).resolves.toEqual({ tail: 1 });
  });

  it("rejects unary JSON bodies that exceed maxResponseBytes", async () => {
    const big = JSON.stringify({ code: 0, data: { blob: "x".repeat(512) }, message: "" });
    const fetchImpl = vi.fn(
      async () =>
        new Response(big, { headers: { "content-type": "application/json" }, status: 200 }),
    ) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl, maxResponseBytes: 64 });

    await expect(
      client.dispatchUnary({ data: {}, op: "text_embedding", pluginId: "p", tenantId: "t" }),
    ).rejects.toThrow(/response exceeds|too large/iu);
  });
});
