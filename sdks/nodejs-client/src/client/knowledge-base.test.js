import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeBaseClient } from "./knowledge-base";
import { createHttpClientWithSpies } from "../../tests/test-utils";

describe("KnowledgeBaseClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles dataset and tag operations", async () => {
    const { client, request } = createHttpClientWithSpies();
    const kb = new KnowledgeBaseClient(client);

    await kb.listDatasets({
      page: 1,
      limit: 2,
      keyword: "k",
      includeAll: true,
      tagIds: ["t1"],
    });
    await kb.createDataset({ name: "dataset" });
    await kb.getDataset("ds");
    await kb.updateDataset("ds", { name: "new" });
    await kb.deleteDataset("ds");
    await kb.updateDocumentStatus("ds", "enable", ["doc1"]);

    await kb.listTags();
    await kb.createTag({ name: "tag" });
    await kb.updateTag({ tag_id: "tag", name: "name" });
    await kb.deleteTag({ tag_id: "tag" });
    await kb.bindTags({ tag_ids: ["tag"], target_id: "doc" });
    await kb.unbindTags({ tag_id: "tag", target_id: "doc" });
    await kb.getDatasetTags("ds");

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/datasets",
      query: {
        page: 1,
        limit: 2,
        keyword: "k",
        include_all: true,
        tag_ids: ["t1"],
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets",
      data: { name: "dataset" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/datasets/ds",
      data: { name: "new" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/datasets/ds/documents/status/enable",
      data: { document_ids: ["doc1"] },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/tags/binding",
      data: { tag_ids: ["tag"], target_id: "doc" },
    });
  });

  it("handles document operations", async () => {
    const { client, request } = createHttpClientWithSpies();
    const kb = new KnowledgeBaseClient(client);
    const form = { append: vi.fn(), getHeaders: () => ({}) };

    await kb.createDocumentByText("ds", { name: "doc", text: "text" });
    await kb.updateDocumentByText("ds", "doc", { name: "doc2" });
    await kb.createDocumentByFile("ds", form);
    await kb.updateDocumentByFile("ds", "doc", form);
    await kb.listDocuments("ds", { page: 1, limit: 20, keyword: "k" });
    await kb.getDocument("ds", "doc", { metadata: "all" });
    await kb.deleteDocument("ds", "doc");
    await kb.getDocumentIndexingStatus("ds", "batch");

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/document/create_by_text",
      data: { name: "doc", text: "text" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/documents/doc/update_by_text",
      data: { name: "doc2" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/document/create_by_file",
      data: form,
    });
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/datasets/ds/documents",
      query: { page: 1, limit: 20, keyword: "k", status: undefined },
    });
  });

  it("handles segments and child chunks", async () => {
    const { client, request } = createHttpClientWithSpies();
    const kb = new KnowledgeBaseClient(client);

    await kb.createSegments("ds", "doc", { segments: [{ content: "x" }] });
    await kb.listSegments("ds", "doc", { page: 1, limit: 10, keyword: "k" });
    await kb.getSegment("ds", "doc", "seg");
    await kb.updateSegment("ds", "doc", "seg", {
      segment: { content: "y" },
    });
    await kb.deleteSegment("ds", "doc", "seg");

    await kb.createChildChunk("ds", "doc", "seg", { content: "c" });
    await kb.listChildChunks("ds", "doc", "seg", { page: 1, limit: 10 });
    await kb.updateChildChunk("ds", "doc", "seg", "child", {
      content: "c2",
    });
    await kb.deleteChildChunk("ds", "doc", "seg", "child");

    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/documents/doc/segments",
      data: { segments: [{ content: "x" }] },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/documents/doc/segments/seg",
      data: { segment: { content: "y" } },
    });
    expect(request).toHaveBeenCalledWith({
      method: "PATCH",
      path: "/datasets/ds/documents/doc/segments/seg/child_chunks/child",
      data: { content: "c2" },
    });
  });

  it("handles metadata and retrieval", async () => {
    const { client, request } = createHttpClientWithSpies();
    const kb = new KnowledgeBaseClient(client);

    await kb.listMetadata("ds");
    await kb.createMetadata("ds", { name: "m", type: "string" });
    await kb.updateMetadata("ds", "mid", { name: "m2" });
    await kb.deleteMetadata("ds", "mid");
    await kb.listBuiltInMetadata("ds");
    await kb.updateBuiltInMetadata("ds", "enable");
    await kb.updateDocumentsMetadata("ds", {
      operation_data: [
        { document_id: "doc", metadata_list: [{ id: "m", name: "n" }] },
      ],
    });
    await kb.hitTesting("ds", { query: "q" });
    await kb.retrieve("ds", { query: "q" });

    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/datasets/ds/metadata",
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/metadata",
      data: { name: "m", type: "string" },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/hit-testing",
      data: { query: "q" },
    });
  });

  it("handles pipeline operations", async () => {
    const { client, request, requestStream } = createHttpClientWithSpies();
    const kb = new KnowledgeBaseClient(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const form = { append: vi.fn(), getHeaders: () => ({}) };

    await kb.listDatasourcePlugins("ds", { isPublished: true });
    await kb.runDatasourceNode("ds", "node", {
      inputs: { input: "x" },
      datasource_type: "custom",
      is_published: true,
    });
    await kb.runPipeline("ds", {
      inputs: { input: "x" },
      datasource_type: "custom",
      datasource_info_list: [],
      start_node_id: "start",
      is_published: true,
      response_mode: "streaming",
    });
    await kb.runPipeline("ds", {
      inputs: { input: "x" },
      datasource_type: "custom",
      datasource_info_list: [],
      start_node_id: "start",
      is_published: true,
      response_mode: "blocking",
    });
    await kb.uploadPipelineFile(form);

    expect(warn).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: "/datasets/ds/pipeline/datasource-plugins",
      query: { is_published: true },
    });
    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/pipeline/datasource/nodes/node/run",
      data: {
        inputs: { input: "x" },
        datasource_type: "custom",
        is_published: true,
      },
    });
    expect(requestStream).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/pipeline/run",
      data: {
        inputs: { input: "x" },
        datasource_type: "custom",
        datasource_info_list: [],
        start_node_id: "start",
        is_published: true,
        response_mode: "streaming",
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/ds/pipeline/run",
      data: {
        inputs: { input: "x" },
        datasource_type: "custom",
        datasource_info_list: [],
        start_node_id: "start",
        is_published: true,
        response_mode: "blocking",
      },
    });
    expect(request).toHaveBeenCalledWith({
      method: "POST",
      path: "/datasets/pipeline/file-upload",
      data: form,
    });
  });
});
