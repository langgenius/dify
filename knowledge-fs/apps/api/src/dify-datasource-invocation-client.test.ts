import type { Source } from "@knowledge/core";
import type { DifyDatasourceRuntimeClient } from "@knowledge/dify-datasource-runtime-client";
import { describe, expect, it, vi } from "vitest";

import { createDifyDatasourceInvocationClient } from "./dify-datasource-invocation-client";
import { createApiOnlineDriveConnector } from "./online-drive-options";

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

  it("maps legacy product crawl options to the Firecrawl datasource parameters", async () => {
    const getWebsiteCrawl = vi.fn(() => chunks({ result: { web_info_list: [] } }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ getWebsiteCrawl }),
    });
    const source: Source = {
      ...SOURCE,
      metadata: {
        credentialId: "dify-credential-1",
        crawlOptions: { includeSubpages: false, limit: 1 },
        datasource: "crawl",
        parameters: { formats: ["markdown"] },
        pluginId: "langgenius/firecrawl_datasource",
        provider: "firecrawl",
      },
      type: "web",
      uri: "https://example.com",
    };

    await collect(
      adapter.dispatch({
        operation: "get_website_crawl",
        source,
        tenantId: "tenant-1",
      }),
    );

    expect(getWebsiteCrawl).toHaveBeenCalledWith({
      credentialId: "dify-credential-1",
      datasource: "crawl",
      datasourceParameters: {
        crawl_subpages: false,
        formats: ["markdown"],
        limit: 1,
        url: "https://example.com",
      },
      pluginId: "langgenius/firecrawl_datasource",
      provider: "firecrawl",
      tenantId: "tenant-1",
    });
  });

  it("preserves exact datasource parameters for declaration-driven website sources", async () => {
    const getWebsiteCrawl = vi.fn(() => chunks({ result: { web_info_list: [] } }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ getWebsiteCrawl }),
    });
    const source: Source = {
      ...SOURCE,
      metadata: {
        credentialId: "dify-credential-1",
        crawlOptions: { includeSubpages: false, limit: 1 },
        datasource: "search_extract",
        datasourceParameterMode: "exact",
        parameters: { query: "dify knowledge", search_depth: "advanced" },
        pluginId: "langgenius/tavily_datasource",
        provider: "tavily",
      },
      type: "web",
      uri: "datasource://tavily",
    };

    await collect(
      adapter.dispatch({
        operation: "get_website_crawl",
        source,
        tenantId: "tenant-1",
      }),
    );

    expect(getWebsiteCrawl).toHaveBeenCalledWith({
      credentialId: "dify-credential-1",
      datasource: "search_extract",
      datasourceParameters: { query: "dify knowledge", search_depth: "advanced" },
      pluginId: "langgenius/tavily_datasource",
      provider: "tavily",
      tenantId: "tenant-1",
    });
  });

  it("preserves an explicitly empty declaration-driven parameter set", async () => {
    const getWebsiteCrawl = vi.fn(() => chunks({ result: { web_info_list: [] } }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ getWebsiteCrawl }),
    });
    const source: Source = {
      ...SOURCE,
      metadata: {
        credentialId: "dify-credential-1",
        crawlOptions: { includeSubpages: true, limit: 200 },
        datasource: "optional_search",
        datasourceParameterMode: "exact",
        parameters: {},
        pluginId: "langgenius/optional_search_datasource",
        provider: "optional_search",
      },
      type: "web",
      uri: "datasource://optional-search",
    };

    await collect(
      adapter.dispatch({
        operation: "get_website_crawl",
        source,
        tenantId: "tenant-1",
      }),
    );

    expect(getWebsiteCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceParameters: {} }),
    );
  });

  it("maps legacy Jina crawl options to crawl_sub_pages", async () => {
    const getWebsiteCrawl = vi.fn(() => chunks({ result: { web_info_list: [] } }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ getWebsiteCrawl }),
    });
    const source: Source = {
      ...SOURCE,
      metadata: {
        credentialId: "jina-credential-1",
        crawlOptions: { includeSubpages: true, limit: 10 },
        datasource: "jina_reader",
        parameters: {},
        pluginId: "langgenius/jina_datasource",
        provider: "jinareader",
      },
      type: "web",
      uri: "https://example.com",
    };

    await collect(
      adapter.dispatch({
        operation: "get_website_crawl",
        source,
        tenantId: "tenant-1",
      }),
    );

    expect(getWebsiteCrawl).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceParameters: {
          crawl_sub_pages: true,
          limit: 10,
          url: "https://example.com",
        },
      }),
    );
  });

  it("uses declaration-driven online drive parameters as the browse root", async () => {
    const browseOnlineDrive = vi.fn(() => chunks({ result: [] }));
    const adapter = createDifyDatasourceInvocationClient({
      client: difyClient({ browseOnlineDrive }),
    });
    const source: Source = {
      ...SOURCE,
      metadata: {
        ...SOURCE.metadata,
        datasource: "shared_drive",
        parameters: {
          bucket: "manuals",
          max_keys: 50,
          next_page_parameters: { cursor: "saved" },
          prefix: "products/",
        },
        providerKind: "online-drive",
      },
      uri: "gdrive://shared-drive",
    };

    const connector = createApiOnlineDriveConnector({ client: adapter });

    await connector.browse({ source, tenantId: "tenant-1" });

    expect(browseOnlineDrive).toHaveBeenCalledWith({
      bucket: "manuals",
      credentialId: "dify-credential-1",
      datasource: "shared_drive",
      maxKeys: 50,
      nextPageParameters: { cursor: "saved" },
      pluginId: "langgenius/notion_datasource",
      prefix: "products/",
      provider: "notion_datasource",
      tenantId: "tenant-1",
    });
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
