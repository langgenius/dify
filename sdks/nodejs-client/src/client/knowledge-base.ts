import { DifyClient } from "./base";
import type {
  DatasetCreateRequest,
  DatasetListOptions,
  DatasetTagBindingRequest,
  DatasetTagCreateRequest,
  DatasetTagDeleteRequest,
  DatasetTagUnbindingRequest,
  DatasetTagUpdateRequest,
  DatasetUpdateRequest,
  DocumentGetOptions,
  DocumentListOptions,
  DocumentStatusAction,
  DocumentTextCreateRequest,
  DocumentTextUpdateRequest,
  SegmentCreateRequest,
  SegmentListOptions,
  SegmentUpdateRequest,
  ChildChunkCreateRequest,
  ChildChunkListOptions,
  ChildChunkUpdateRequest,
  MetadataCreateRequest,
  MetadataOperationRequest,
  MetadataUpdateRequest,
  HitTestingRequest,
  DatasourcePluginListOptions,
  DatasourceNodeRunRequest,
  PipelineRunRequest,
  KnowledgeBaseResponse,
  PipelineStreamEvent,
} from "../types/knowledge-base";
import type { DifyResponse, DifyStream, QueryParams } from "../types/common";
import {
  ensureNonEmptyString,
  ensureOptionalBoolean,
  ensureOptionalInt,
  ensureOptionalString,
  ensureStringArray,
} from "./validation";
import { FileUploadError, ValidationError } from "../errors/dify-error";
import { isFormData } from "../http/form-data";

const warned = new Set<string>();
const warnOnce = (message: string): void => {
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  console.warn(message);
};

const ensureFormData = (form: unknown, context: string): void => {
  if (!isFormData(form)) {
    throw new FileUploadError(`${context} requires FormData`);
  }
};

const ensureNonEmptyArray = (value: unknown, name: string): void => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty array`);
  }
};

const warnPipelineRoutes = (): void => {
  warnOnce(
    "RAG pipeline endpoints may be unavailable unless the service API registers dataset/rag_pipeline routes."
  );
};

export class KnowledgeBaseClient extends DifyClient {
  async listDatasets(
    options?: DatasetListOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");
    ensureOptionalString(options?.keyword, "keyword");
    ensureOptionalBoolean(options?.includeAll, "includeAll");

    const query: QueryParams = {
      page: options?.page,
      limit: options?.limit,
      keyword: options?.keyword ?? undefined,
      include_all: options?.includeAll ?? undefined,
    };

    if (options?.tagIds && options.tagIds.length > 0) {
      ensureStringArray(options.tagIds, "tagIds");
      query.tag_ids = options.tagIds;
    }

    return this.http.request({
      method: "GET",
      path: "/datasets",
      query,
    });
  }

  async createDataset(
    request: DatasetCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(request.name, "name");
    return this.http.request({
      method: "POST",
      path: "/datasets",
      data: request,
    });
  }

  async getDataset(datasetId: string): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}`,
    });
  }

  async updateDataset(
    datasetId: string,
    request: DatasetUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    if (request.name !== undefined && request.name !== null) {
      ensureNonEmptyString(request.name, "name");
    }
    return this.http.request({
      method: "PATCH",
      path: `/datasets/${datasetId}`,
      data: request,
    });
  }

  async deleteDataset(datasetId: string): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "DELETE",
      path: `/datasets/${datasetId}`,
    });
  }

  async updateDocumentStatus(
    datasetId: string,
    action: DocumentStatusAction,
    documentIds: string[]
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(action, "action");
    ensureStringArray(documentIds, "documentIds");
    return this.http.request({
      method: "PATCH",
      path: `/datasets/${datasetId}/documents/status/${action}`,
      data: {
        document_ids: documentIds,
      },
    });
  }

  async listTags(): Promise<DifyResponse<KnowledgeBaseResponse>> {
    return this.http.request({
      method: "GET",
      path: "/datasets/tags",
    });
  }

  async createTag(
    request: DatasetTagCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(request.name, "name");
    return this.http.request({
      method: "POST",
      path: "/datasets/tags",
      data: request,
    });
  }

  async updateTag(
    request: DatasetTagUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(request.tag_id, "tag_id");
    ensureNonEmptyString(request.name, "name");
    return this.http.request({
      method: "PATCH",
      path: "/datasets/tags",
      data: request,
    });
  }

  async deleteTag(
    request: DatasetTagDeleteRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(request.tag_id, "tag_id");
    return this.http.request({
      method: "DELETE",
      path: "/datasets/tags",
      data: request,
    });
  }

  async bindTags(
    request: DatasetTagBindingRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureStringArray(request.tag_ids, "tag_ids");
    ensureNonEmptyString(request.target_id, "target_id");
    return this.http.request({
      method: "POST",
      path: "/datasets/tags/binding",
      data: request,
    });
  }

  async unbindTags(
    request: DatasetTagUnbindingRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(request.tag_id, "tag_id");
    ensureNonEmptyString(request.target_id, "target_id");
    return this.http.request({
      method: "POST",
      path: "/datasets/tags/unbinding",
      data: request,
    });
  }

  async getDatasetTags(
    datasetId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/tags`,
    });
  }

  async createDocumentByText(
    datasetId: string,
    request: DocumentTextCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(request.name, "name");
    ensureNonEmptyString(request.text, "text");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/document/create_by_text`,
      data: request,
    });
  }

  async updateDocumentByText(
    datasetId: string,
    documentId: string,
    request: DocumentTextUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    if (request.name !== undefined && request.name !== null) {
      ensureNonEmptyString(request.name, "name");
    }
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/${documentId}/update_by_text`,
      data: request,
    });
  }

  async createDocumentByFile(
    datasetId: string,
    form: unknown
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureFormData(form, "createDocumentByFile");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/document/create_by_file`,
      data: form,
    });
  }

  async updateDocumentByFile(
    datasetId: string,
    documentId: string,
    form: unknown
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureFormData(form, "updateDocumentByFile");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/${documentId}/update_by_file`,
      data: form,
    });
  }

  async listDocuments(
    datasetId: string,
    options?: DocumentListOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");
    ensureOptionalString(options?.keyword, "keyword");
    ensureOptionalString(options?.status, "status");

    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents`,
      query: {
        page: options?.page,
        limit: options?.limit,
        keyword: options?.keyword ?? undefined,
        status: options?.status ?? undefined,
      },
    });
  }

  async getDocument(
    datasetId: string,
    documentId: string,
    options?: DocumentGetOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    if (options?.metadata) {
      const allowed = new Set(["all", "only", "without"]);
      if (!allowed.has(options.metadata)) {
        throw new ValidationError("metadata must be one of all, only, without");
      }
    }
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents/${documentId}`,
      query: {
        metadata: options?.metadata ?? undefined,
      },
    });
  }

  async deleteDocument(
    datasetId: string,
    documentId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    return this.http.request({
      method: "DELETE",
      path: `/datasets/${datasetId}/documents/${documentId}`,
    });
  }

  async getDocumentIndexingStatus(
    datasetId: string,
    batch: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(batch, "batch");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents/${batch}/indexing-status`,
    });
  }

  async createSegments(
    datasetId: string,
    documentId: string,
    request: SegmentCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyArray(request.segments, "segments");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/${documentId}/segments`,
      data: request,
    });
  }

  async listSegments(
    datasetId: string,
    documentId: string,
    options?: SegmentListOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");
    ensureOptionalString(options?.keyword, "keyword");
    if (options?.status && options.status.length > 0) {
      ensureStringArray(options.status, "status");
    }

    const query: QueryParams = {
      page: options?.page,
      limit: options?.limit,
      keyword: options?.keyword ?? undefined,
    };
    if (options?.status && options.status.length > 0) {
      query.status = options.status;
    }

    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents/${documentId}/segments`,
      query,
    });
  }

  async getSegment(
    datasetId: string,
    documentId: string,
    segmentId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`,
    });
  }

  async updateSegment(
    datasetId: string,
    documentId: string,
    segmentId: string,
    request: SegmentUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`,
      data: request,
    });
  }

  async deleteSegment(
    datasetId: string,
    documentId: string,
    segmentId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    return this.http.request({
      method: "DELETE",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`,
    });
  }

  async createChildChunk(
    datasetId: string,
    documentId: string,
    segmentId: string,
    request: ChildChunkCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    ensureNonEmptyString(request.content, "content");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`,
      data: request,
    });
  }

  async listChildChunks(
    datasetId: string,
    documentId: string,
    segmentId: string,
    options?: ChildChunkListOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    ensureOptionalInt(options?.page, "page");
    ensureOptionalInt(options?.limit, "limit");
    ensureOptionalString(options?.keyword, "keyword");

    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`,
      query: {
        page: options?.page,
        limit: options?.limit,
        keyword: options?.keyword ?? undefined,
      },
    });
  }

  async updateChildChunk(
    datasetId: string,
    documentId: string,
    segmentId: string,
    childChunkId: string,
    request: ChildChunkUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    ensureNonEmptyString(childChunkId, "childChunkId");
    ensureNonEmptyString(request.content, "content");
    return this.http.request({
      method: "PATCH",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`,
      data: request,
    });
  }

  async deleteChildChunk(
    datasetId: string,
    documentId: string,
    segmentId: string,
    childChunkId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(documentId, "documentId");
    ensureNonEmptyString(segmentId, "segmentId");
    ensureNonEmptyString(childChunkId, "childChunkId");
    return this.http.request({
      method: "DELETE",
      path: `/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`,
    });
  }

  async listMetadata(
    datasetId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/metadata`,
    });
  }

  async createMetadata(
    datasetId: string,
    request: MetadataCreateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(request.name, "name");
    ensureNonEmptyString(request.type, "type");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/metadata`,
      data: request,
    });
  }

  async updateMetadata(
    datasetId: string,
    metadataId: string,
    request: MetadataUpdateRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(metadataId, "metadataId");
    ensureNonEmptyString(request.name, "name");
    return this.http.request({
      method: "PATCH",
      path: `/datasets/${datasetId}/metadata/${metadataId}`,
      data: request,
    });
  }

  async deleteMetadata(
    datasetId: string,
    metadataId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(metadataId, "metadataId");
    return this.http.request({
      method: "DELETE",
      path: `/datasets/${datasetId}/metadata/${metadataId}`,
    });
  }

  async listBuiltInMetadata(
    datasetId: string
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/metadata/built-in`,
    });
  }

  async updateBuiltInMetadata(
    datasetId: string,
    action: "enable" | "disable"
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(action, "action");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/metadata/built-in/${action}`,
    });
  }

  async updateDocumentsMetadata(
    datasetId: string,
    request: MetadataOperationRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyArray(request.operation_data, "operation_data");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/documents/metadata`,
      data: request,
    });
  }

  async hitTesting(
    datasetId: string,
    request: HitTestingRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    if (request.query !== undefined && request.query !== null) {
      ensureOptionalString(request.query, "query");
    }
    if (request.attachment_ids && request.attachment_ids.length > 0) {
      ensureStringArray(request.attachment_ids, "attachment_ids");
    }
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/hit-testing`,
      data: request,
    });
  }

  async retrieve(
    datasetId: string,
    request: HitTestingRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    ensureNonEmptyString(datasetId, "datasetId");
    return this.http.request({
      method: "POST",
      path: `/datasets/${datasetId}/retrieve`,
      data: request,
    });
  }

  async listDatasourcePlugins(
    datasetId: string,
    options?: DatasourcePluginListOptions
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    warnPipelineRoutes();
    ensureNonEmptyString(datasetId, "datasetId");
    ensureOptionalBoolean(options?.isPublished, "isPublished");
    return this.http.request({
      method: "GET",
      path: `/datasets/${datasetId}/pipeline/datasource-plugins`,
      query: {
        is_published: options?.isPublished ?? undefined,
      },
    });
  }

  async runDatasourceNode(
    datasetId: string,
    nodeId: string,
    request: DatasourceNodeRunRequest
  ): Promise<DifyStream<PipelineStreamEvent>> {
    warnPipelineRoutes();
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(nodeId, "nodeId");
    ensureNonEmptyString(request.datasource_type, "datasource_type");
    return this.http.requestStream<PipelineStreamEvent>({
      method: "POST",
      path: `/datasets/${datasetId}/pipeline/datasource/nodes/${nodeId}/run`,
      data: request,
    });
  }

  async runPipeline(
    datasetId: string,
    request: PipelineRunRequest
  ): Promise<DifyResponse<KnowledgeBaseResponse> | DifyStream<PipelineStreamEvent>> {
    warnPipelineRoutes();
    ensureNonEmptyString(datasetId, "datasetId");
    ensureNonEmptyString(request.datasource_type, "datasource_type");
    ensureNonEmptyString(request.start_node_id, "start_node_id");
    const shouldStream = request.response_mode === "streaming";
    if (shouldStream) {
      return this.http.requestStream<PipelineStreamEvent>({
        method: "POST",
        path: `/datasets/${datasetId}/pipeline/run`,
        data: request,
      });
    }
    return this.http.request<KnowledgeBaseResponse>({
      method: "POST",
      path: `/datasets/${datasetId}/pipeline/run`,
      data: request,
    });
  }

  async uploadPipelineFile(
    form: unknown
  ): Promise<DifyResponse<KnowledgeBaseResponse>> {
    warnPipelineRoutes();
    ensureFormData(form, "uploadPipelineFile");
    return this.http.request({
      method: "POST",
      path: "/datasets/pipeline/file-upload",
      data: form,
    });
  }
}
