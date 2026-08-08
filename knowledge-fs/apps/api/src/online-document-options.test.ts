import type { OnlineDocumentListInput } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

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

  it("concatenates Dify datasource text messages into page content", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const client = clientYielding(
      [
        { message: { text: "# Page One\n" }, type: "text" },
        { message: { text: "Notion body" }, type: "text" },
      ],
      calls,
    );

    const content = await createApiOnlineDocumentConnector({ client }).getPageContent({
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(content).toEqual({ content: "# Page One\nNotion body", pageId: "p1" });
    expect(calls[0]).toMatchObject({
      operation: "get_online_document_page_content",
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });
  });

  it("keeps supporting structured page-content envelopes", async () => {
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
  });

  it("keeps empty content valid and logs only bounded frame metadata", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const client = clientYielding(
      [
        { message: { text: "" }, meta: { credential: "must-not-log" }, type: "text" },
        { message: { json_object: { ignored: true } }, type: "json" },
      ],
      calls,
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const content = await createApiOnlineDocumentConnector({ client }).getPageContent({
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(content).toEqual({ content: "", pageId: "p1" });
    expect(info).toHaveBeenCalledOnce();
    const diagnostic = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(diagnostic)).toMatchObject({
      contentBytes: 0,
      event: "knowledge_fs.online_document.content_frames",
      frameCount: 2,
      frameTypes: { json: 1, text: 1 },
      messageKeys: ["json_object", "text"],
      pageId: "p1",
      recognizedFrames: 1,
      sourceId: SOURCE.id,
    });
    expect(diagnostic).not.toContain("must-not-log");
    info.mockRestore();
  });

  it("aggregates Dify datasource content variable messages", async () => {
    const calls: ApiDatasourceInvocationInput[] = [];
    const client = clientYielding(
      [
        {
          message: { stream: true, variable_name: "content", variable_value: "# Page " },
          type: "variable",
        },
        {
          message: { stream: true, variable_name: "content", variable_value: "One" },
          type: "variable",
        },
        {
          message: { stream: false, variable_name: "title", variable_value: "Ignored" },
          type: "variable",
        },
      ],
      calls,
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const content = await createApiOnlineDocumentConnector({ client }).getPageContent({
      page: { pageId: "p1", type: "page", workspaceId: "w1" },
      source: SOURCE,
      tenantId: "tenant-1",
    });

    expect(content).toEqual({ content: "# Page One", pageId: "p1" });
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      contentBytes: 10,
      frameCount: 3,
      frameTypes: { variable: 3 },
      recognizedFrames: 2,
    });
    info.mockRestore();
  });
});
