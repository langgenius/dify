import type { Source } from "@knowledge/core";
import type { DifyDatasourceRuntimeClient } from "@knowledge/dify-datasource-runtime-client";
import { describe, expect, it, vi } from "vitest";

import { createDifyDatasourceInvocationClient } from "./dify-datasource-invocation-client";

const SOURCE: Source = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    credentialId: "dify-credential-1",
    datasource: "notion_datasource",
    parameters: { include_archived: false },
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

describe("createDifyDatasourceInvocationClient", () => {
  it("maps connector operations to the Dify datasource runtime using only credential_id", async () => {
    const getOnlineDocumentPages = vi.fn(() => chunks({ result: [] }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ getOnlineDocumentPages }),
    });

    await expect(
      collect(
        adapter.dispatch({
          cursor: "cursor-1",
          limit: 25,
          operation: "get_online_document_pages",
          source: SOURCE,
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      ),
    ).resolves.toEqual([{ result: [] }]);

    expect(getOnlineDocumentPages).toHaveBeenCalledWith({
      credentialId: "dify-credential-1",
      datasource: "notion_datasource",
      datasourceParameters: {
        cursor: "cursor-1",
        include_archived: false,
        limit: 25,
      },
      pluginId: "langgenius/notion_datasource",
      provider: "notion_datasource",
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(JSON.stringify(getOnlineDocumentPages.mock.calls)).not.toContain("credentials");
  });

  it("rejects inline credentials in integrated mode", async () => {
    const adapter = createDifyDatasourceInvocationClient({ client: difyClient() });
    const source = {
      ...SOURCE,
      metadata: { ...SOURCE.metadata, credentials: { token: "must-not-cross" } },
    };

    await expect(
      collect(
        adapter.dispatch({
          operation: "get_online_document_pages",
          source,
          tenantId: "tenant-1",
        }),
      ),
    ).rejects.toThrow("Inline datasource credentials are forbidden in integrated mode");

    await expect(
      collect(
        adapter.dispatch({
          operation: "get_online_document_pages",
          source: {
            ...SOURCE,
            metadata: {
              ...SOURCE.metadata,
              parameters: { nested: { access_token: "must-not-cross" } },
            },
          },
          tenantId: "tenant-1",
        }),
      ),
    ).rejects.toThrow("Inline datasource credentials are forbidden in integrated mode");
  });

  it("validates the Dify credential binding using the source provider kind", async () => {
    const validateCredentials = vi.fn(async () => true);
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ validateCredentials }),
    });

    await expect(
      collect(
        adapter.dispatch({
          operation: "validate_credentials",
          source: SOURCE,
          tenantId: "tenant-1",
        }),
      ),
    ).resolves.toEqual([{ result: true }]);

    expect(validateCredentials).toHaveBeenCalledWith({
      credentialId: "dify-credential-1",
      datasource: "notion_datasource",
      datasourceType: "online_document",
      pluginId: "langgenius/notion_datasource",
      provider: "notion_datasource",
      tenantId: "tenant-1",
    });
  });
});

function difyClient(
  overrides: Partial<DifyDatasourceRuntimeClient> = {},
): DifyDatasourceRuntimeClient {
  return {
    browseOnlineDrive: () => chunks(),
    downloadOnlineDriveFile: () => chunks(),
    getOnlineDocumentPageContent: () => chunks(),
    getOnlineDocumentPages: () => chunks(),
    getWebsiteCrawl: () => chunks(),
    validateCredentials: async () => false,
    ...overrides,
  };
}

async function* chunks(...values: unknown[]): AsyncGenerator<unknown> {
  for (const value of values) yield value;
}

async function collect(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of input) values.push(value);
  return values;
}
