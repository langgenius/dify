import type { WebsiteCrawlInput } from "@knowledge/api";
import type {
  PluginDaemonClient,
  PluginDaemonDatasourceInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import { createApiWebsiteCrawlConnector } from "./website-crawl-options";

const WEB_SOURCE: WebsiteCrawlInput["source"] = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    datasource: "crawl",
    parameters: { limit: 5 },
    pluginId: "langgenius/firecrawl_datasource",
    provider: "firecrawl",
  },
  name: "Docs crawl",
  permissionScope: [],
  status: "active",
  type: "web",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "https://example.com",
  version: 1,
};

function crawlEnvelope(
  status: string,
  completed: number,
  pages: readonly { content: string; description?: string; source_url: string; title?: string }[],
) {
  return { result: { completed, status, total: 2, web_info_list: pages } };
}

describe("createApiWebsiteCrawlConnector", () => {
  it("dispatches get_website_crawl and accumulates streamed pages (latest content wins)", async () => {
    const calls: PluginDaemonDatasourceInput[] = [];
    const client: PluginDaemonClient = {
      dispatchDatasourceStream: (input) => {
        calls.push(input);

        return (async function* () {
          yield crawlEnvelope("processing", 1, [
            { content: "old", source_url: "https://example.com/a", title: "A" },
          ]);
          yield crawlEnvelope("completed", 2, [
            {
              content: "# A",
              description: "the a page",
              source_url: "https://example.com/a",
              title: "A",
            },
            { content: "# B", source_url: "https://example.com/b" },
          ]);
        })();
      },
      dispatchStream: () => (async function* () {})(),
      dispatchUnary: async () => {
        throw new Error("unused");
      },
    };

    const connector = createApiWebsiteCrawlConnector({ client });
    const result = await connector.crawl({ source: WEB_SOURCE, tenantId: "tenant-1" });

    expect(result).toEqual({
      completed: 2,
      pages: [
        {
          content: "# A",
          description: "the a page",
          sourceUrl: "https://example.com/a",
          title: "A",
        },
        { content: "# B", sourceUrl: "https://example.com/b" },
      ],
      status: "completed",
      total: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      data: {
        credentials: {},
        datasource: "crawl",
        datasource_parameters: { limit: 5, url: "https://example.com" },
        provider: "firecrawl",
      },
      method: "get_website_crawl",
      pluginId: "langgenius/firecrawl_datasource",
      tenantId: "tenant-1",
    });
  });

  it("ignores envelopes without a crawl result payload", async () => {
    const client: PluginDaemonClient = {
      dispatchDatasourceStream: () =>
        (async function* () {
          yield { unrelated: true };
          yield crawlEnvelope("completed", 1, [
            { content: "# A", source_url: "https://example.com/a" },
          ]);
        })(),
      dispatchStream: () => (async function* () {})(),
      dispatchUnary: async () => {
        throw new Error("unused");
      },
    };

    const connector = createApiWebsiteCrawlConnector({ client });
    const result = await connector.crawl({ source: WEB_SOURCE, tenantId: "tenant-1" });

    expect(result.pages).toEqual([{ content: "# A", sourceUrl: "https://example.com/a" }]);
  });
});
