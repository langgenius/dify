import type { OnlineDocumentListInput } from "@knowledge/api";
import { describe, expect, it } from "vitest";

import type {
  ApiDatasourceInvocationClient,
  ApiDatasourceInvocationInput,
} from "./datasource-invocation-client";
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
  calls: ApiDatasourceInvocationInput[],
): ApiDatasourceInvocationClient {
  return {
    dispatch: (input) => {
      calls.push(input);

      return (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })();
    },
  };
}

describe("createApiOnlineDocumentConnector", () => {
  it("lists pages, deduping across streamed workspace envelopes", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
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
    expect(result.workspaces[0]).toMatchObject({
      total: 2,
      workspaceId: "w1",
      workspaceName: "WS",
    });
    expect(result.workspaces[0]?.pages).toEqual([
      { pageId: "p1", pageName: "One (edited)", type: "page" },
      { pageId: "p2", pageName: "Two", type: "database" },
    ]);
    expect(calls[0]).toMatchObject({
      operation: "get_online_document_pages",
      source: SOURCE,
      tenantId: "tenant-1",
    });
    expect(JSON.stringify(calls[0])).not.toContain("credentials");
  });

  it("fetches page content with the page ref and returns the last non-empty content", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
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
      operation: "get_online_document_page_content",
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });
  });
});
