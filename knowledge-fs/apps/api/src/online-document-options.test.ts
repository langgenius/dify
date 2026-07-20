import type { OnlineDocumentListInput } from "@knowledge/api";
import type {
  PluginDaemonClient,
  PluginDaemonDatasourceInput,
} from "@knowledge/plugin-daemon-client";
import { describe, expect, it } from "vitest";

import { createApiOnlineDocumentConnector } from "./online-document-options";

const SOURCE: OnlineDocumentListInput["source"] = {
  createdAt: "2026-07-03T00:00:00.000Z",
  id: "00000000-0000-4000-8000-000000000001",
  knowledgeSpaceId: "10000000-0000-4000-8000-000000000001",
  metadata: {
    datasource: "notion_datasource",
    pluginId: "langgenius/notion_datasource",
    provider: "notion_datasource",
  },
  name: "Notion",
  permissionScope: [],
  status: "active",
  type: "connector",
  updatedAt: "2026-07-03T00:00:00.000Z",
  uri: "workspace-1",
  version: 1,
};

function clientYielding(
  chunks: readonly unknown[],
  calls: PluginDaemonDatasourceInput[],
): PluginDaemonClient {
  return {
    dispatchDatasourceStream: (input) => {
      calls.push(input);

      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
    dispatchStream: () => (async function* () {})(),
    dispatchUnary: async () => {
      throw new Error("unused");
    },
  };
}

describe("createApiOnlineDocumentConnector", () => {
  it("lists pages, deduping across streamed workspace envelopes", async () => {
    const calls: PluginDaemonDatasourceInput[] = [];
    const client = clientYielding(
      [
        {
          result: [
            {
              pages: [{ last_edited_time: "t1", page_id: "p1", page_name: "One", type: "page" }],
              total: 2,
              workspace_id: "w1",
              workspace_name: "WS",
            },
          ],
        },
        {
          result: [
            {
              pages: [
                { page_id: "p1", page_name: "One (edited)", type: "page" },
                { page_id: "p2", page_name: "Two", type: "database" },
              ],
              total: 2,
              workspace_id: "w1",
            },
          ],
        },
      ],
      calls,
    );

    const result = await createApiOnlineDocumentConnector({ client }).listPages({
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({ total: 2, workspaceId: "w1", workspaceName: "WS" });
    expect(result.workspaces[0]?.pages).toEqual([
      { pageId: "p1", pageName: "One (edited)", type: "page" },
      { pageId: "p2", pageName: "Two", type: "database" },
    ]);
    expect(calls[0]).toMatchObject({
      data: {
        credentials: {},
        datasource: "notion_datasource",
        datasource_parameters: {},
        provider: "notion_datasource",
      },
      method: "get_online_document_pages",
      pluginId: "langgenius/notion_datasource",
      tenantId: "tenant-1",
    });
  });

  it("fetches page content with the page ref and returns the last non-empty content", async () => {
    const calls: PluginDaemonDatasourceInput[] = [];
    const client = clientYielding(
      [
        { result: { content: "", page_id: "p1", workspace_id: "w1" } },
        { result: { content: "# Page One", page_id: "p1", workspace_id: "w1" } },
      ],
      calls,
    );

    const content = await createApiOnlineDocumentConnector({ client }).getPageContent({
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(content).toEqual({ content: "# Page One", pageId: "p1", workspaceId: "w1" });
    expect(calls[0]).toMatchObject({
      data: {
        credentials: {},
        datasource: "notion_datasource",
        page: { page_id: "p1", type: "page", workspace_id: "w1" },
        provider: "notion_datasource",
      },
      method: "get_online_document_page_content",
      pluginId: "langgenius/notion_datasource",
      tenantId: "tenant-1",
    });
  });
});
