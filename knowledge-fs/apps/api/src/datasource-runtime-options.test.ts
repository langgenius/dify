import type { Source } from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiDatasourceInvocationClient } from "./datasource-runtime-options";

const DIFY_SOURCE: Source = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    credentialId: "dify-credential-1",
    datasource: "notion_datasource",
    pluginId: "langgenius/notion_datasource",
    provider: "notion_datasource",
    providerKind: "online-document",
  },
  name: "Notion",
  permissionScope: [],
  status: "active",
  type: "connector",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "notion://workspace",
  version: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("createApiDatasourceInvocationClient", () => {
  it("selects Dify exclusively in integrated mode", async () => {
    const requests: { readonly init?: RequestInit; readonly input: RequestInfo | URL }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, ...(init ? { init } : {}) });
      return responseFromBytes(frame({ data: { result: [] }, error: "" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createApiDatasourceInvocationClient({
      DIFY_INNER_API_KEY: "inner-key",
      DIFY_INNER_API_URL: "http://api:5001",
      KNOWLEDGE_INTEGRATED_MODE_ENABLED: "true",
      // If the standalone branch is accidentally constructed, this must fail validation.
      PLUGIN_DAEMON_MAX_RESPONSE_BYTES: "invalid",
    });

    await collect(
      client.dispatch({
        operation: "get_online_document_pages",
        source: DIFY_SOURCE,
        tenantId: "tenant-1",
      }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requests[0]?.input).toBe("http://api:5001/inner/api/invoke/datasource");
    const body = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      credential_id: "dify-credential-1",
      operation: "get_online_document_pages",
      tenant_id: "tenant-1",
    });
    expect(body).not.toHaveProperty("credentials");
  });

  it("keeps the direct daemon path available only for standalone mode", async () => {
    const requests: { readonly input: RequestInfo | URL }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requests.push({ input });
      return new Response(`${JSON.stringify({ code: 0, data: { result: [] } })}\n`, {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const source: Source = {
      ...DIFY_SOURCE,
      metadata: {
        credentials: { token: "standalone-only" },
        datasource: "notion_datasource",
        pluginId: "langgenius/notion_datasource",
        provider: "notion_datasource",
      },
    };
    const client = createApiDatasourceInvocationClient({
      // If the Dify branch is accidentally constructed, this must fail validation.
      DIFY_DATASOURCE_RUNTIME_MAX_RESPONSE_BYTES: "invalid",
      PLUGIN_DAEMON_KEY: "daemon-key",
      PLUGIN_DAEMON_URL: "http://plugin-daemon:5002",
    });

    await collect(
      client.dispatch({
        operation: "get_online_document_pages",
        source,
        tenantId: "tenant-1",
      }),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(requests[0]?.input)).toContain(
      "/plugin/tenant-1/dispatch/datasource/get_online_document_pages",
    );
  });
});

async function collect(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of input) values.push(value);
  return values;
}

function frame(value: unknown): Uint8Array {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const result = new Uint8Array(14 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint8(0, 0x0f);
  view.setUint16(2, 0x0a, true);
  view.setUint32(4, data.byteLength, true);
  result.set(data, 14);
  return result;
}

function responseFromBytes(bytes: Uint8Array): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { status: 200 },
  );
}
