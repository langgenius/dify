import { describe, expect, it, vi } from "vitest";

import type { DifyDatasourceRuntimeError } from "./index";
import { createDifyDatasourceRuntimeClient } from "./index";

const COMMON = {
  credentialId: "credential-1",
  datasource: "notion_datasource",
  pluginId: "langgenius/notion_datasource",
  provider: "notion_datasource",
  tenantId: "tenant-1",
};

describe("createDifyDatasourceRuntimeClient", () => {
  it("invokes website crawl through Dify without accepting datasource credentials", async () => {
    let requestBody: Record<string, unknown> | undefined;
    let requestHeaders: Headers | undefined;
    const client = createDifyDatasourceRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requestHeaders = new Headers(init?.headers);
        return responseFromBytes(frame({ data: { result: { web_info_list: [] } }, error: "" }));
      }),
    });

    const chunks = await collect(
      client.getWebsiteCrawl({
        ...COMMON,
        datasource: "firecrawl",
        datasourceParameters: { url: "https://example.com" },
        pluginId: "langgenius/firecrawl_datasource",
        provider: "firecrawl",
        userId: "user-1",
      }),
    );

    expect(chunks).toEqual([{ result: { web_info_list: [] } }]);
    expect(requestBody).toEqual({
      credential_id: "credential-1",
      datasource: "firecrawl",
      datasource_parameters: { url: "https://example.com" },
      datasource_type: "website_crawl",
      operation: "get_website_crawl",
      provider: "langgenius/firecrawl_datasource/firecrawl",
      tenant_id: "tenant-1",
      user_id: "user-1",
    });
    expect(requestHeaders?.get("x-inner-api-key")).toBe("inner-secret");
    expect(JSON.stringify(requestBody)).not.toContain("credentials");
  });

  it("maps online-drive pagination and validates a stored credential binding", async () => {
    const requests: Record<string, unknown>[] = [];
    const responses = [
      frame({ data: { result: [] }, error: "" }),
      frame({ data: { result: true }, error: "" }),
    ];
    const client = createDifyDatasourceRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return responseFromBytes(responses.shift() ?? new Uint8Array());
      }),
    });

    await collect(
      client.browseOnlineDrive({
        ...COMMON,
        datasource: "google_drive",
        nextPageParameters: { page_token: "opaque" },
        pluginId: "langgenius/google_drive",
        prefix: "folder/",
        provider: "google_drive",
      }),
    );
    await expect(
      client.validateCredentials({
        ...COMMON,
        datasourceType: "online_document",
      }),
    ).resolves.toBe(true);

    expect(requests[0]).toMatchObject({
      datasource_type: "online_drive",
      operation: "online_drive_browse_files",
      request: {
        max_keys: 20,
        next_page_parameters: { page_token: "opaque" },
        prefix: "folder/",
      },
    });
    expect(requests[1]).toMatchObject({
      datasource_type: "online_document",
      operation: "validate_credentials",
    });
  });

  it("fails closed on inner errors and malformed routing identifiers", async () => {
    const client = createDifyDatasourceRuntimeClient({
      apiKey: "inner-secret",
      baseUrl: "http://api:5001",
      fetch: vi.fn(async () =>
        responseFromBytes(frame({ data: null, error: "credential content must stay hidden" })),
      ),
    });

    await expect(
      collect(client.getOnlineDocumentPages({ ...COMMON, datasourceParameters: {} })),
    ).rejects.toMatchObject({
      code: "dify_datasource_runtime_invocation_failed",
      message: "Dify datasource runtime invocation failed",
    } satisfies Partial<DifyDatasourceRuntimeError>);

    expect(() =>
      client.getOnlineDocumentPages({
        ...COMMON,
        datasourceParameters: {},
        pluginId: "not-canonical",
      }),
    ).toThrow("organization/plugin format");
  });
});

async function collect(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return chunks;
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
