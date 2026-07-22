import { describe, expect, it, vi } from "vitest";

import { DifyModelRuntimeError, createDifyModelRuntimeClient } from "./index";

const EMBEDDING_INPUT = {
  inputType: "document" as const,
  model: "embedding",
  pluginId: "vendor/plugin",
  provider: "provider",
  tenantId: "tenant-1",
  texts: ["hello"],
};

describe("createDifyModelRuntimeClient", () => {
  it("invokes text embeddings through Dify without accepting model credentials", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        url: String(input),
      });
      return Response.json({
        data: { embeddings: [[0.1, 0.2]], model: "text-embedding-3-small" },
        error: "",
      });
    });
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: fetchImpl,
    });

    const result = await client.invokeTextEmbedding({
      inputType: "query",
      model: "text-embedding-3-small",
      pluginId: "langgenius/openai",
      provider: "openai",
      tenantId: "tenant-1",
      texts: ["hello"],
    });

    expect(result).toEqual({ embeddings: [[0.1, 0.2]], model: "text-embedding-3-small" });
    expect(requests).toEqual([
      {
        body: {
          input_type: "query",
          model: "text-embedding-3-small",
          model_type: "text-embedding",
          provider: "langgenius/openai/openai",
          tenant_id: "tenant-1",
          texts: ["hello"],
          user_id: "knowledge-fs",
        },
        headers: expect.any(Headers),
        url: "http://api:5001/inner/api/invoke/text-embedding",
      },
    ]);
    expect(requests[0]?.headers.get("x-inner-api-key")).toBe("inner-secret");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("credentials");
  });

  it("invokes rerank with optional bounds omitted", async () => {
    let body: Record<string, unknown> | undefined;
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001/",
      fetch: vi.fn(async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          data: { docs: [{ index: 0, score: 0.9 }], model: "rerank" },
          error: "",
        });
      }),
    });

    await client.invokeRerank({
      docs: ["document"],
      model: "rerank",
      pluginId: "vendor/rerank",
      provider: "provider",
      query: "query",
      tenantId: "tenant-1",
    });

    expect(body).toMatchObject({
      docs: ["document"],
      model_type: "rerank",
      provider: "vendor/rerank/provider",
      query: "query",
    });
    expect(body).not.toHaveProperty("score_threshold");
    expect(body).not.toHaveProperty("top_n");
  });

  it("parses Dify length-prefixed LLM frames across arbitrary network chunks", async () => {
    const first = frame({ data: { delta: { message: { content: "hel" } } }, error: "" });
    const second = frame({
      data: { delta: { finish_reason: "stop", message: { content: "lo" } } },
      error: "",
    });
    const bytes = concat(first, second);
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7, 19));
        controller.enqueue(bytes.slice(19));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(responseBody, {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }),
    );
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: fetchImpl,
    });

    const chunks: unknown[] = [];
    for await (const chunk of client.invokeLlm({
      completionParams: { max_tokens: 32, temperature: 0 },
      model: "gpt-4.1-mini",
      pluginId: "langgenius/openai",
      promptMessages: [{ content: "question", role: "user" }],
      provider: "openai",
      tenantId: "tenant-1",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { delta: { message: { content: "hel" } } },
      { delta: { finish_reason: "stop", message: { content: "lo" } } },
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("lists tenant-active models through the Dify catalog endpoint", async () => {
    let body: unknown;
    const item = {
      capabilities: { modelProperties: { context_size: 8191 } },
      model: "text-embedding-3-small",
      model_type: "text-embedding",
      plugin_id: "langgenius/openai",
      plugin_unique_identifier: "langgenius/openai:1.0.0@sha256:installed",
      provider: "openai",
    };
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ data: { items: [item], next_offset: 50 }, error: "" });
      }),
    });

    const result = await client.listModels({
      limit: 50,
      modelType: "text-embedding",
      offset: 0,
      tenantId: "tenant-1",
    });

    expect(result).toEqual({ items: [item], nextOffset: 50 });
    expect(body).toEqual({
      limit: 50,
      model_type: "text-embedding",
      offset: 0,
      tenant_id: "tenant-1",
      user_id: "knowledge-fs",
    });
  });

  it("fails closed on an inner runtime error", async () => {
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async () => Response.json({ data: null, error: "provider secret leaked" })),
    });

    await expect(
      client.invokeTextEmbedding({
        inputType: "document",
        model: "embedding",
        pluginId: "vendor/plugin",
        provider: "provider",
        tenantId: "tenant-1",
        texts: ["hello"],
      }),
    ).rejects.toMatchObject({
      code: "dify_model_runtime_invocation_failed",
      message: "Dify model runtime invocation failed",
    } satisfies Partial<DifyModelRuntimeError>);
  });

  it.each([
    [{ baseUrl: "" }, "baseUrl must be an absolute"],
    [{ baseUrl: "api:5001" }, "baseUrl must be an absolute"],
    [{ apiKey: " " }, "apiKey is required"],
    [{ maxResponseBytes: 0 }, "maxResponseBytes must be a positive integer"],
    [{ maxResponseBytes: 1.5 }, "maxResponseBytes must be a positive integer"],
    [{ requestTimeoutMs: 0 }, "requestTimeoutMs is outside"],
    [{ requestTimeoutMs: 600_001 }, "requestTimeoutMs is outside"],
    [{ requestTimeoutMs: 1.5 }, "requestTimeoutMs is outside"],
    [{ userId: "u".repeat(513) }, "userId is invalid"],
  ] as const)("validates client option %#", (override, message) => {
    expect(() =>
      createDifyModelRuntimeClient({
        apiKey: "inner-secret",
        baseUrl: "http://api:5001",
        ...override,
      }),
    ).toThrow(message);
  });

  it("validates model routing identifiers and empty model inputs before dispatch", () => {
    const client = successfulClient();

    expect(() => client.invokeTextEmbedding({ ...EMBEDDING_INPUT, texts: [] })).toThrow(
      "requires at least one text",
    );
    expect(() =>
      client.invokeRerank({
        docs: [],
        model: "rerank",
        pluginId: "vendor/plugin",
        provider: "provider",
        query: "query",
        tenantId: "tenant-1",
      }),
    ).toThrow("requires at least one document");
    expect(() =>
      client.invokeMultimodalEmbedding({
        documents: [],
        inputType: "document",
        model: "multimodal",
        pluginId: "vendor/plugin",
        provider: "provider",
        tenantId: "tenant-1",
      }),
    ).toThrow("requires at least one document");

    for (const [override, message] of [
      [{ model: " " }, "model is invalid"],
      [{ tenantId: " " }, "tenantId is invalid"],
      [{ pluginId: "plugin" }, "organization/plugin format"],
      [{ pluginId: "Vendor/Plugin" }, "organization/plugin format"],
      [{ provider: "bad/provider" }, "provider must be a provider slug"],
    ] as const) {
      expect(() => client.invokeTextEmbedding({ ...EMBEDDING_INPUT, ...override })).toThrow(
        message,
      );
    }
  });

  it("maps bounded rerank and multimodal embedding payloads", async () => {
    const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (input, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          url: String(input),
        });
        return Response.json({ data: { ok: true }, error: "" });
      }),
    });

    await client.invokeRerank({
      docs: ["one", "two"],
      model: "rerank",
      pluginId: "vendor/plugin",
      provider: "provider",
      query: "query",
      scoreThreshold: 0.4,
      tenantId: "tenant-1",
      topN: 1,
    });
    await client.invokeMultimodalEmbedding({
      documents: [{ content: "AQID", content_type: "image", file_id: "image.png" }],
      inputType: "query",
      model: "clip",
      pluginId: "vendor/plugin",
      provider: "provider",
      tenantId: "tenant-1",
    });

    expect(requests).toEqual([
      {
        body: expect.objectContaining({ score_threshold: 0.4, top_n: 1 }),
        url: "http://api:5001/inner/api/invoke/rerank",
      },
      {
        body: expect.objectContaining({
          documents: [{ content: "AQID", content_type: "image", file_id: "image.png" }],
          input_type: "query",
        }),
        url: "http://api:5001/inner/api/invoke/multimodal-embedding",
      },
    ]);
  });

  it("maps optional LLM request fields and a custom service user", async () => {
    let body: unknown;
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return responseFromBytes(frame({ data: { delta: {} }, error: "" }));
      }),
      userId: "knowledge-worker",
    });

    await expect(
      collect(
        client.invokeLlm({
          model: "llm",
          pluginId: "vendor/plugin",
          promptMessages: [],
          provider: "provider",
          stop: ["stop"],
          tenantId: "tenant-1",
          tools: [{ name: "search" }],
        }),
      ),
    ).resolves.toEqual([{ delta: {} }]);
    expect(body).toMatchObject({
      completion_params: {},
      stop: ["stop"],
      stream: true,
      tools: [{ name: "search" }],
      user_id: "knowledge-worker",
    });
  });

  it("validates catalog bounds and paired provider filters", async () => {
    const client = successfulClient();

    for (const limit of [0, 101, 1.5]) {
      await expect(
        client.listModels({ limit, modelType: "llm", tenantId: "tenant-1" }),
      ).rejects.toThrow("limit must be between 1 and 100");
    }
    for (const offset of [-1, 1.5]) {
      await expect(
        client.listModels({ limit: 1, modelType: "llm", offset, tenantId: "tenant-1" }),
      ).rejects.toThrow("offset must be a non-negative integer");
    }
    await expect(
      client.listModels({
        limit: 1,
        modelType: "llm",
        pluginId: "vendor/plugin",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("must be supplied together");
    await expect(
      client.listModels({
        limit: 1,
        modelType: "llm",
        provider: "provider",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("must be supplied together");
  });

  it("maps catalog filters and omits a null next offset", async () => {
    let body: unknown;
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ data: { items: [], next_offset: null }, error: "" });
      }),
    });

    await expect(
      client.listModels({
        limit: 2,
        model: "gpt",
        modelType: "llm",
        offset: 4,
        pluginId: "vendor/plugin",
        provider: "provider",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual({ items: [] });
    expect(body).toMatchObject({
      model: "gpt",
      offset: 4,
      provider: "vendor/plugin/provider",
    });
  });

  it("rejects malformed catalog data", async () => {
    const client = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async () => Response.json({ data: { items: "invalid" }, error: "" })),
    });

    await expect(
      client.listModels({ limit: 1, modelType: "llm", tenantId: "tenant-1" }),
    ).rejects.toMatchObject({ code: "dify_model_runtime_response_invalid" });
  });

  it("normalizes transport failures and HTTP retryability without leaking response bodies", async () => {
    const networkClient = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async () => Promise.reject(new Error("network secret"))),
    });
    await expect(networkClient.invokeTextEmbedding(EMBEDDING_INPUT)).rejects.toMatchObject({
      code: "dify_model_runtime_request_failed",
      message: "Dify model runtime request failed",
      retryable: true,
    });

    for (const [status, retryable] of [
      [400, false],
      [408, true],
      [429, true],
      [503, true],
    ] as const) {
      const client = createDifyModelRuntimeClient({
        apiKey: "inner-secret",
        baseUrl: "http://api:5001",
        fetch: vi.fn(async () => new Response("provider secret", { status })),
      });
      await expect(client.invokeTextEmbedding(EMBEDDING_INPUT)).rejects.toMatchObject({
        code: "dify_model_runtime_request_failed",
        message: "Dify model runtime request failed",
        retryable,
        status,
      });
    }
  });

  it("distinguishes caller aborts from request timeouts", async () => {
    const abortController = new AbortController();
    const abortedClient = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: abortAwareFetch(),
    });
    const aborted = abortedClient.invokeTextEmbedding({
      ...EMBEDDING_INPUT,
      signal: abortController.signal,
    });
    abortController.abort("caller canceled");
    await expect(aborted).rejects.toMatchObject({ code: "dify_model_runtime_aborted" });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      abortedClient.invokeTextEmbedding({ ...EMBEDDING_INPUT, signal: preAborted.signal }),
    ).rejects.toThrow("request was aborted");

    const timeoutClient = createDifyModelRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: abortAwareFetch(),
      requestTimeoutMs: 5,
    });
    await expect(timeoutClient.invokeTextEmbedding(EMBEDDING_INPUT)).rejects.toMatchObject({
      code: "dify_model_runtime_timeout",
      retryable: true,
    });
  });

  it("rejects missing, malformed, and oversized unary response bodies", async () => {
    const cases: ReadonlyArray<[Response, number | undefined, string]> = [
      [new Response(null), undefined, "dify_model_runtime_response_invalid"],
      [new Response("{"), undefined, "dify_model_runtime_response_invalid"],
      [Response.json({ data: {}, error: 7 }), undefined, "dify_model_runtime_response_invalid"],
      [
        new Response("{}", { headers: { "content-length": "100" } }),
        10,
        "dify_model_runtime_response_too_large",
      ],
      [
        Response.json({ data: { value: "too-large" }, error: "" }),
        5,
        "dify_model_runtime_response_too_large",
      ],
    ];

    for (const [response, maxResponseBytes, code] of cases) {
      const client = createDifyModelRuntimeClient({
        apiKey: "inner-secret",
        baseUrl: "http://api:5001",
        fetch: vi.fn(async () => response),
        ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
      });
      await expect(client.invokeTextEmbedding(EMBEDDING_INPUT)).rejects.toMatchObject({ code });
    }
  });

  it.each([
    [mutateFrame(frame({ data: {}, error: "" }), (bytes) => bytes.set([1], 0)), 1_024],
    [
      mutateFrame(frame({ data: {}, error: "" }), (bytes) =>
        new DataView(bytes.buffer).setUint16(2, 9, true),
      ),
      1_024,
    ],
    [declaredOversizedFrame(), 32],
    [framePayload(new TextEncoder().encode("{")), 1_024],
    [frame({ data: {}, error: "" }).slice(0, -1), 1_024],
    [frame({ data: { value: "too-large" }, error: "" }), 8],
  ] as const)("rejects malformed or oversized LLM frame %#", async (bytes, maxResponseBytes) => {
    const client = llmClient(bytes, maxResponseBytes);
    await expect(collect(client.invokeLlm(llmInput()))).rejects.toBeInstanceOf(
      DifyModelRuntimeError,
    );
  });

  it("rejects invalid and failed LLM envelopes plus a missing stream body", async () => {
    for (const response of [
      responseFromBytes(frame({ data: {}, error: 7 })),
      responseFromBytes(frame({ data: null, error: "model secret" })),
      new Response(null),
    ]) {
      const client = createDifyModelRuntimeClient({
        apiKey: "inner-secret",
        baseUrl: "http://api:5001",
        fetch: vi.fn(async () => response),
      });
      await expect(collect(client.invokeLlm(llmInput()))).rejects.toBeInstanceOf(
        DifyModelRuntimeError,
      );
    }
  });
});

function frame(value: unknown): Uint8Array {
  return framePayload(new TextEncoder().encode(JSON.stringify(value)));
}

function framePayload(payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(14 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint8(0, 0x0f);
  view.setUint8(1, 0);
  view.setUint16(2, 0x0a, true);
  view.setUint32(4, payload.length, true);
  result.set(payload, 14);
  return result;
}

function declaredOversizedFrame(): Uint8Array {
  const result = new Uint8Array(8);
  const view = new DataView(result.buffer);
  view.setUint8(0, 0x0f);
  view.setUint16(2, 0x0a, true);
  view.setUint32(4, 100, true);
  return result;
}

function mutateFrame(value: Uint8Array, mutate: (copy: Uint8Array) => void): Uint8Array {
  const copy = value.slice();
  mutate(copy);
  return copy;
}

function successfulClient() {
  return createDifyModelRuntimeClient({
    apiKey: "inner-secret",
    baseUrl: "http://api:5001",
    fetch: vi.fn(async () => Response.json({ data: { ok: true }, error: "" })),
  });
}

function abortAwareFetch(): typeof fetch {
  return vi.fn(async (_input, init) => {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
}

function llmClient(bytes: Uint8Array, maxResponseBytes: number) {
  return createDifyModelRuntimeClient({
    apiKey: "inner-secret",
    baseUrl: "http://api:5001",
    fetch: vi.fn(async () => responseFromBytes(bytes)),
    maxResponseBytes,
  });
}

function responseFromBytes(bytes: Uint8Array): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(copy.buffer);
}

function llmInput() {
  return {
    model: "llm",
    pluginId: "vendor/plugin",
    promptMessages: [],
    provider: "provider",
    tenantId: "tenant-1",
  } as const;
}

async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
