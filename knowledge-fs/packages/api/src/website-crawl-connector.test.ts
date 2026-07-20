import { SourceSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  WebsiteCrawlConnectorConfigError,
  readWebsiteCrawlSourceConfig,
} from "./website-crawl-connector";

function webSource(metadata: Record<string, unknown>) {
  return SourceSchema.parse({
    createdAt: "2026-07-03T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
    metadata,
    name: "Docs crawl",
    permissionScope: [],
    status: "active",
    type: "web",
    updatedAt: "2026-07-03T00:00:00.000Z",
    uri: "https://example.com",
  });
}

describe("readWebsiteCrawlSourceConfig", () => {
  it("reads daemon config and injects the crawl URL from the source uri", () => {
    const config = readWebsiteCrawlSourceConfig(
      webSource({
        datasource: "crawl",
        parameters: { limit: 10 },
        pluginId: "langgenius/firecrawl_datasource",
        provider: "firecrawl",
      }),
    );

    expect(config).toEqual({
      credentials: {},
      datasource: "crawl",
      parameters: { limit: 10, url: "https://example.com" },
      pluginId: "langgenius/firecrawl_datasource",
      provider: "firecrawl",
    });
  });

  it("keeps an explicit parameters.url over the source uri and passes credentials through", () => {
    const config = readWebsiteCrawlSourceConfig(
      webSource({
        credentials: { api_key: "secret" },
        datasource: "crawl",
        parameters: { url: "https://docs.example.com/start" },
        pluginId: "langgenius/firecrawl_datasource",
        provider: "firecrawl",
      }),
    );

    expect(config.parameters.url).toBe("https://docs.example.com/start");
    expect(config.credentials).toEqual({ api_key: "secret" });
  });

  it("rejects a non-web source and missing required metadata", () => {
    const connectorSource = SourceSchema.parse({
      createdAt: "2026-07-03T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
      knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
      metadata: {},
      name: "Notion",
      permissionScope: [],
      status: "active",
      type: "connector",
      updatedAt: "2026-07-03T00:00:00.000Z",
      uri: "workspace-1",
    });

    expect(() => readWebsiteCrawlSourceConfig(connectorSource)).toThrow(
      WebsiteCrawlConnectorConfigError,
    );
    expect(() => readWebsiteCrawlSourceConfig(webSource({ provider: "firecrawl" }))).toThrow(
      /pluginId is required/,
    );
  });
});
