import { afterEach, describe, expect, it, vi } from "vitest";

import { PluginDaemonError, createPluginDaemonClient } from "./index";

const OPTIONS = {
  apiKey: "plugin-api-key",
  baseUrl: "http://plugin-daemon:5002/",
} as const;

const MODEL_SCHEMA = {
  deprecated: false,
  features: [],
  fetch_from: "predefined-model",
  label: { en_US: "Embedding 3 Large" },
  model: "text-embedding-3-large",
  model_properties: { context_size: 8_191 },
  model_type: "text-embedding",
  parameter_rules: [],
} as const;

const MODEL_PROVIDER = {
  created_at: "2026-07-14T12:34:56.000Z",
  declaration: {
    configurate_methods: ["predefined-model"],
    label: { en_US: "OpenAI" },
    models: [MODEL_SCHEMA],
    provider: "openai",
    supported_model_types: ["llm", "text-embedding", "rerank"],
  },
  id: "0198aa4e-5ddd-7ff0-8bdf-0ed076b4831e",
  plugin_id: "langgenius/openai",
  plugin_unique_identifier: "langgenius/openai:0.2.3@sha256:abc",
  provider: "openai",
  tenant_id: "tenant-abc",
  updated_at: "2026-07-14T12:35:56.000Z",
} as const;

function jsonEnvelope(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ code: 0, data, message: "success" }), {
    headers: { "content-type": "application/json" },
    status: 200,
    ...init,
  });
}

function sseEnvelope(data: unknown, init: ResponseInit = {}): Response {
  return new Response(`data: ${JSON.stringify({ code: 0, data, message: "" })}\n\n`, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("plugin-daemon model management client", () => {
  it("lists the tenant model catalog with the upstream bounded paging contract", async () => {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });
      return jsonEnvelope([MODEL_PROVIDER]);
    }) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(client.listModelProviders({ tenantId: " tenant-abc " })).resolves.toEqual([
      MODEL_PROVIDER,
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "http://plugin-daemon:5002/plugin/tenant-abc/management/models?page=1&page_size=256",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers).toEqual({
      accept: "application/json",
      "x-api-key": "plugin-api-key",
    });
  });

  it("sends the exact upstream schema dispatch payload and validates the response", async () => {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });
      return sseEnvelope({ model_schema: MODEL_SCHEMA });
    }) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.getModelSchema({
        credentials: { api_key: "secret-value" },
        model: "text-embedding-3-large",
        modelType: "text-embedding",
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
        userId: "user-1",
      }),
    ).resolves.toEqual(MODEL_SCHEMA);

    expect(calls[0]?.url).toBe("http://plugin-daemon:5002/plugin/tenant-abc/dispatch/model/schema");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toEqual({
      accept: "text/event-stream",
      "content-type": "application/json",
      "x-api-key": "plugin-api-key",
      "x-plugin-id": "langgenius/openai",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      data: {
        credentials: { api_key: "secret-value" },
        model: "text-embedding-3-large",
        model_type: "text-embedding",
        provider: "openai",
      },
      user_id: "user-1",
    });
  });

  it("uses the provider and model credential validation endpoints without inventing fields", async () => {
    const calls: Array<{ init: RequestInit; url: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ init, url });
      return sseEnvelope({ credentials: { normalized: "credential-ref" }, result: true });
    }) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.validateProviderCredentials({
        credentials: { api_key: "provider-secret" },
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      }),
    ).resolves.toEqual({ credentials: { normalized: "credential-ref" }, result: true });
    await expect(
      client.validateModelCredentials({
        credentials: { api_key: "model-secret" },
        model: "rerank-english-v3.0",
        modelType: "rerank",
        pluginId: "langgenius/cohere",
        provider: "cohere",
        tenantId: "tenant-abc",
      }),
    ).resolves.toEqual({ credentials: { normalized: "credential-ref" }, result: true });

    expect(calls.map((call) => call.url)).toEqual([
      "http://plugin-daemon:5002/plugin/tenant-abc/dispatch/model/validate_provider_credentials",
      "http://plugin-daemon:5002/plugin/tenant-abc/dispatch/model/validate_model_credentials",
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      data: { credentials: { api_key: "provider-secret" }, provider: "openai" },
    });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      data: {
        credentials: { api_key: "model-secret" },
        model: "rerank-english-v3.0",
        model_type: "rerank",
        provider: "cohere",
      },
    });
  });

  it("rejects invalid request bounds before performing I/O", async () => {
    const fetchImpl = vi.fn(async () => jsonEnvelope([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.listModelProviders({ page: 0, tenantId: "tenant-abc" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_input" });
    await expect(
      client.listModelProviders({ pageSize: 257, tenantId: "tenant-abc" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_input" });
    await expect(client.listModelProviders({ tenantId: "\r\n" })).rejects.toMatchObject({
      code: "plugin_daemon_input",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on cross-tenant, inconsistent, oversized, and malformed catalog responses", async () => {
    const crossTenant = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        jsonEnvelope([
          { ...MODEL_PROVIDER, tenant_id: "tenant-other" },
        ])) as unknown as typeof fetch,
    });
    await expect(crossTenant.listModelProviders({ tenantId: "tenant-abc" })).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
    });

    const inconsistent = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        jsonEnvelope([
          { ...MODEL_PROVIDER, declaration: { ...MODEL_PROVIDER.declaration, provider: "other" } },
        ])) as unknown as typeof fetch,
    });
    await expect(inconsistent.listModelProviders({ tenantId: "tenant-abc" })).rejects.toMatchObject(
      { code: "plugin_daemon_response_invalid" },
    );

    const malformed = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        jsonEnvelope([
          { ...MODEL_PROVIDER, declaration: { ...MODEL_PROVIDER.declaration, models: [{}] } },
        ])) as unknown as typeof fetch,
    });
    await expect(malformed.listModelProviders({ tenantId: "tenant-abc" })).rejects.toMatchObject({
      code: "plugin_daemon_response_invalid",
    });

    const overPage = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        jsonEnvelope([MODEL_PROVIDER, MODEL_PROVIDER])) as unknown as typeof fetch,
    });
    await expect(
      overPage.listModelProviders({ pageSize: 1, tenantId: "tenant-abc" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("classifies a bounded management timeout even when a fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
      managementRequestTimeoutMs: 25,
    });
    const request = client.listModelProviders({ tenantId: "tenant-abc" });
    const expectation = expect(request).rejects.toMatchObject({ code: "plugin_daemon_timeout" });

    await vi.advanceTimersByTimeAsync(25);
    await expectation;
  });

  it("classifies caller abort independently from timeout", async () => {
    const controller = new AbortController();
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (() => new Promise<Response>(() => undefined)) as unknown as typeof fetch,
    });
    const request = client.listModelProviders({
      signal: controller.signal,
      tenantId: "tenant-abc",
    });

    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
  });

  it("rejects an already-aborted management request without performing I/O", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => jsonEnvelope([])) as unknown as typeof fetch;
    const client = createPluginDaemonClient({ ...OPTIONS, fetch: fetchImpl });

    await expect(
      client.listModelProviders({ signal: controller.signal, tenantId: "tenant-abc" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes unknown management transport failures", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () => {
        throw new Error("socket failure with implementation details");
      }) as unknown as typeof fetch,
    });

    await expect(client.listModelProviders({ tenantId: "tenant-abc" })).rejects.toMatchObject({
      code: "plugin_daemon_request_failed",
      message: "Plugin daemon request failed",
    });
  });

  it("maps management HTTP failures without exposing response bodies", async () => {
    const catalogClient = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        new Response("sensitive upstream body", { status: 503 })) as unknown as typeof fetch,
    });
    await expect(
      catalogClient.listModelProviders({ tenantId: "tenant-abc" }),
    ).rejects.toMatchObject({ code: "plugin_daemon_request_failed", status: 503 });

    const schemaClient = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        new Response("sensitive upstream body", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(
      schemaClient.getModelSchema({
        credentials: { api_key: "must-not-leak" },
        model: "text-embedding-3-large",
        modelType: "text-embedding",
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_rate_limited", status: 429 });
  });

  it("rejects a model management stream that returns no data", async () => {
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        new Response(": keep-alive\n\n", {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        })) as unknown as typeof fetch,
    });

    await expect(
      client.validateProviderCredentials({
        credentials: { api_key: "secret" },
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_response_invalid" });
  });

  it("redacts credential values from nested daemon failures", async () => {
    const secret = "sk-do-not-leak-this";
    const daemonMessage = JSON.stringify({
      error_type: "PluginInvokeError",
      message: JSON.stringify({
        error_type: "CredentialsValidateFailedError",
        message: `credential ${secret} is invalid`,
      }),
    });
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        new Response(
          `data: ${JSON.stringify({ code: -500, data: null, message: daemonMessage })}\n\n`,
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    const error = await client
      .validateProviderCredentials({
        credentials: { api_key: secret },
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(secret);
  });

  it("redacts secrets echoed by every credential-bearing management dispatch", async () => {
    const secret = "management-secret-with-special/?=";
    const daemonMessage = JSON.stringify({
      error_type: "PluginInvokeError",
      message: JSON.stringify({
        error_type: `CredentialsValidateFailedError:${secret}`,
        message: `credential ${encodeURIComponent(secret)} is invalid`,
      }),
    });
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: (async () =>
        new Response(
          `data: ${JSON.stringify({ code: -500, data: null, message: daemonMessage })}\n\n`,
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const calls = [
      () =>
        client.getModelSchema({
          credentials: { nested: { api_key: secret } },
          model: "text-embedding-3-large",
          modelType: "text-embedding",
          pluginId: "langgenius/openai",
          provider: "openai",
          tenantId: "tenant-abc",
        }),
      () =>
        client.validateModelCredentials({
          credentials: { api_key: secret },
          model: "rerank-english-v3.0",
          modelType: "rerank",
          pluginId: "langgenius/cohere",
          provider: "cohere",
          tenantId: "tenant-abc",
        }),
      () =>
        client.validateProviderCredentials({
          credentials: { api_key: secret },
          pluginId: "langgenius/openai",
          provider: "openai",
          tenantId: "tenant-abc",
        }),
    ];

    for (const call of calls) {
      const error = await call().catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(PluginDaemonError);
      expect((error as PluginDaemonError).errorType).toBe(
        "CredentialsValidateFailedError:[REDACTED]",
      );
      expect((error as PluginDaemonError).errorType).not.toContain(secret);
      expect((error as Error).message).toContain("[REDACTED]");
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(encodeURIComponent(secret));
    }
  });

  it("rejects non-JSON and over-budget credential payloads without echoing their values", async () => {
    const fetchImpl = vi.fn(async () => sseEnvelope({ result: true })) as unknown as typeof fetch;
    const client = createPluginDaemonClient({
      ...OPTIONS,
      fetch: fetchImpl,
      maxManagementRequestBytes: 64,
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      client.validateProviderCredentials({
        credentials: circular,
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      }),
    ).rejects.toMatchObject({ code: "plugin_daemon_input" });

    const secret = "private-value-that-must-not-appear";
    const error = await client
      .validateProviderCredentials({
        credentials: { api_key: secret.repeat(8) },
        pluginId: "langgenius/openai",
        provider: "openai",
        tenantId: "tenant-abc",
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PluginDaemonError);
    expect((error as Error).message).not.toContain(secret);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates management option bounds", () => {
    expect(() => createPluginDaemonClient({ ...OPTIONS, managementRequestTimeoutMs: 0 })).toThrow(
      "managementRequestTimeoutMs",
    );
    expect(() =>
      createPluginDaemonClient({ ...OPTIONS, managementRequestTimeoutMs: 600_001 }),
    ).toThrow("managementRequestTimeoutMs");
    expect(() => createPluginDaemonClient({ ...OPTIONS, maxManagementRequestBytes: 0 })).toThrow(
      "maxManagementRequestBytes",
    );
  });
});
