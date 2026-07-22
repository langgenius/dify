import type { Source } from "@knowledge/core";
import type {
  PluginDaemonDatasourceClient,
  PluginDaemonDatasourceInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import { createStandaloneDatasourceInvocationClient } from "./standalone-datasource-invocation-client";

const SOURCE: Source = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    credentials: { api_key: "standalone-secret" },
    datasource: "crawl",
    parameters: { limit: 5 },
    pluginId: "langgenius/firecrawl_datasource",
    provider: "firecrawl",
  },
  name: "Standalone crawl",
  permissionScope: [],
  status: "active",
  type: "web",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "https://example.com",
  version: 1,
};

describe("createStandaloneDatasourceInvocationClient", () => {
  it("preserves the legacy direct daemon contract only in the standalone adapter", async () => {
    const calls: PluginDaemonDatasourceInput[] = [];
    const daemon: PluginDaemonDatasourceClient = {
      dispatchDatasourceStream(input) {
        calls.push(input);
        return chunks({ result: { status: "completed" } });
      },
    };
    const adapter = createStandaloneDatasourceInvocationClient({ client: daemon });

    await expect(
      collect(
        adapter.dispatch({
          operation: "get_website_crawl",
          source: SOURCE,
          tenantId: "tenant-1",
          userId: "user-1",
        }),
      ),
    ).resolves.toEqual([{ result: { status: "completed" } }]);
    expect(calls).toEqual([
      {
        data: {
          credentials: { api_key: "standalone-secret" },
          datasource: "crawl",
          datasource_parameters: { limit: 5, url: "https://example.com" },
          provider: "firecrawl",
        },
        method: "get_website_crawl",
        pluginId: "langgenius/firecrawl_datasource",
        tenantId: "tenant-1",
        userId: "user-1",
      },
    ]);
  });
});

async function* chunks(...values: unknown[]): AsyncGenerator<unknown> {
  for (const value of values) yield value;
}

async function collect(input: AsyncIterable<unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for await (const value of input) values.push(value);
  return values;
}
