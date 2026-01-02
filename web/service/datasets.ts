import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { BuiltInMetadataItem, MetadataBatchEditToServer, MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import type {
  ApiKeysListResponse,
  CreateApiKeyResponse,
} from '@/models/app'
import type { CommonResponse, DataSourceNotionWorkspace } from '@/models/common'
import type {
  BatchImportResponse,
  ChildChunkDetail,
  ChildSegmentsResponse,
  ChunkingMode,
  CreateDocumentReq,
  createDocumentResponse,
  DataSet,
  DataSetListResponse,
  DocumentActionType,
  DocumentDetailResponse,
  DocumentListResponse,
  ErrorDocsResponse,
  ExternalAPIDeleteResponse,
  ExternalAPIItem,
  ExternalAPIListResponse,
  ExternalAPIUsage,
  ExternalKnowledgeBaseHitTestingResponse,
  ExternalKnowledgeItem,
  FetchDatasetsParams,
  FileIndexingEstimateResponse,
  HitTestingRecordsResponse,
  HitTestingResponse,
  IndexingEstimateParams,
  IndexingEstimateResponse,
  IndexingStatusBatchResponse,
  IndexingStatusResponse,
  ProcessRuleResponse,
  RelatedAppResponse,
  SegmentDetailModel,
  SegmentsResponse,
  SegmentUpdater,
} from '@/models/datasets'
import type { RetrievalConfig } from '@/types/app'
import qs from 'qs'
import { DataSourceProvider } from '@/models/common'
import { del, get, patch, post, put } from './base'

// apis for documents in a dataset

type CommonDocReq = {
  datasetId: string
  documentId: string
}

type BatchReq = {
  datasetId: string
  batchId: string
}

export type SortType = 'created_at' | 'hit_count' | '-created_at' | '-hit_count'

export type MetadataType = 'all' | 'only' | 'without'

export const fetchDatasetDetail = (datasetId: string): Promise<DataSet> => {
  return get<DataSet>(`/datasets/${datasetId}`)
}

export const updateDatasetSetting = ({
  datasetId,
  body,
}: {
  datasetId: string
  body: Partial<Pick<DataSet, 'name' | 'description' | 'permission' | 'partial_member_list' | 'indexing_technique' | 'retrieval_model' | 'embedding_model' | 'embedding_model_provider' | 'icon_info' | 'doc_form'>>
}): Promise<DataSet> => {
  return patch<DataSet>(`/datasets/${datasetId}`, { body })
}

export const fetchDatasetRelatedApps = (datasetId: string): Promise<RelatedAppResponse> => {
  return get<RelatedAppResponse>(`/datasets/${datasetId}/related-apps`)
}

export const fetchDatasets = ({ url, params }: FetchDatasetsParams): Promise<DataSetListResponse> => {
  const urlParams = qs.stringify(params, { indices: false })
  return get<DataSetListResponse>(`${url}?${urlParams}`)
}

export const createEmptyDataset = ({ name }: { name: string }): Promise<DataSet> => {
  return post<DataSet>('/datasets', { body: { name } })
}

export const checkIsUsedInApp = (id: string): Promise<{ is_using: boolean }> => {
  return get<{ is_using: boolean }>(`/datasets/${id}/use-check`, {}, {
    silent: true,
  })
}

export const deleteDataset = (datasetID: string): Promise<DataSet> => {
  return del<DataSet>(`/datasets/${datasetID}`)
}

export const fetchExternalAPIList = ({ url }: { url: string }): Promise<ExternalAPIListResponse> => {
  return get<ExternalAPIListResponse>(url)
}

export const fetchExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }): Promise<ExternalAPIItem> => {
  return get<ExternalAPIItem>(`/datasets/external-knowledge-api/${apiTemplateId}`)
}

export const updateExternalAPI = ({ apiTemplateId, body }: { apiTemplateId: string, body: ExternalAPIItem }): Promise<ExternalAPIItem> => {
  return patch<ExternalAPIItem>(`/datasets/external-knowledge-api/${apiTemplateId}`, { body })
}

export const deleteExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }): Promise<ExternalAPIDeleteResponse> => {
  return del<ExternalAPIDeleteResponse>(`/datasets/external-knowledge-api/${apiTemplateId}`)
}

export const checkUsageExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }): Promise<ExternalAPIUsage> => {
  return get<ExternalAPIUsage>(`/datasets/external-knowledge-api/${apiTemplateId}/use-check`)
}

export const createExternalAPI = ({ body }: { body: CreateExternalAPIReq }): Promise<ExternalAPIItem> => {
  return post<ExternalAPIItem>('/datasets/external-knowledge-api', { body })
}

export const createExternalKnowledgeBase = ({ body }: { body: CreateKnowledgeBaseReq }): Promise<ExternalKnowledgeItem> => {
  return post<ExternalKnowledgeItem>('/datasets/external', { body })
}

export const fetchDefaultProcessRule = ({ url }: { url: string }): Promise<ProcessRuleResponse> => {
  return get<ProcessRuleResponse>(url)
}
export const fetchProcessRule = ({ params: { documentId } }: { params: { documentId: string } }): Promise<ProcessRuleResponse> => {
  return get<ProcessRuleResponse>('/datasets/process-rule', { params: { document_id: documentId } })
}

export const createFirstDocument = ({ body }: { body: CreateDocumentReq }): Promise<createDocumentResponse> => {
  return post<createDocumentResponse>('/datasets/init', { body })
}

export const createDocument = ({ datasetId, body }: { datasetId: string, body: CreateDocumentReq }): Promise<createDocumentResponse> => {
  return post<createDocumentResponse>(`/datasets/${datasetId}/documents`, { body })
}

export const fetchIndexingEstimate = ({ datasetId, documentId }: CommonDocReq): Promise<IndexingEstimateResponse> => {
  return get<IndexingEstimateResponse>(`/datasets/${datasetId}/documents/${documentId}/indexing-estimate`, {})
}
export const fetchIndexingEstimateBatch = ({ datasetId, batchId }: BatchReq): Promise<IndexingEstimateResponse> => {
  return get<IndexingEstimateResponse>(`/datasets/${datasetId}/batch/${batchId}/indexing-estimate`, {})
}

export const fetchIndexingStatus = ({ datasetId, documentId }: CommonDocReq): Promise<IndexingStatusResponse> => {
  return get<IndexingStatusResponse>(`/datasets/${datasetId}/documents/${documentId}/indexing-status`, {})
}

export const fetchIndexingStatusBatch = ({ datasetId, batchId }: BatchReq): Promise<IndexingStatusBatchResponse> => {
  return get<IndexingStatusBatchResponse>(`/datasets/${datasetId}/batch/${batchId}/indexing-status`, {})
}

export const renameDocumentName = ({ datasetId, documentId, name }: CommonDocReq & { name: string }): Promise<CommonResponse> => {
  return post<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/rename`, {
    body: { name },
  })
}

export const pauseDocIndexing = ({ datasetId, documentId }: CommonDocReq): Promise<CommonResponse> => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/processing/pause`)
}

export const resumeDocIndexing = ({ datasetId, documentId }: CommonDocReq): Promise<CommonResponse> => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/processing/resume`)
}

export const preImportNotionPages = ({ url, datasetId }: { url: string, datasetId?: string }): Promise<{ notion_info: DataSourceNotionWorkspace[] }> => {
  return get<{ notion_info: DataSourceNotionWorkspace[] }>(url, { params: { dataset_id: datasetId } })
}

export const fetchPreImportNotionPages = ({ datasetId, credentialId }: { datasetId: string, credentialId?: string }): Promise<{ notion_info: DataSourceNotionWorkspace[] }> => {
  return get<{ notion_info: DataSourceNotionWorkspace[] }>('/notion/pre-import/pages', {
    params: {
      dataset_id: datasetId,
      credential_id: credentialId,
    },
  })
}

export const modifyDocMetadata = ({ datasetId, documentId, body }: CommonDocReq & { body: { doc_type: string, doc_metadata: Record<string, any> } }): Promise<CommonResponse> => {
  return put<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/metadata`, { body })
}

// hit testing
export const hitTesting = ({ datasetId, queryText, retrieval_model }: { datasetId: string, queryText: string, retrieval_model: RetrievalConfig }): Promise<HitTestingResponse> => {
  return post<HitTestingResponse>(`/datasets/${datasetId}/hit-testing`, { body: { query: queryText, retrieval_model } })
}

export const externalKnowledgeBaseHitTesting = ({ datasetId, query, external_retrieval_model }: { datasetId: string, query: string, external_retrieval_model: { top_k: number, score_threshold: number, score_threshold_enabled: boolean } }): Promise<ExternalKnowledgeBaseHitTestingResponse> => {
  return post<ExternalKnowledgeBaseHitTestingResponse>(`/datasets/${datasetId}/external-hit-testing`, { body: { query, external_retrieval_model } })
}

export const fetchTestingRecords = ({ datasetId, params }: { datasetId: string, params: { page: number, limit: number } }): Promise<HitTestingRecordsResponse> => {
  return get<HitTestingRecordsResponse>(`/datasets/${datasetId}/queries`, { params })
}

export const fetchFileIndexingEstimate = (body: IndexingEstimateParams): Promise<FileIndexingEstimateResponse> => {
  return post<FileIndexingEstimateResponse>('/datasets/indexing-estimate', { body })
}

export const fetchNotionPagePreview = ({ pageID, pageType, credentialID }: { pageID: string, pageType: string, credentialID: string }): Promise<{ content: string }> => {
  return get<{ content: string }>(`notion/pages/${pageID}/${pageType}/preview`, {
    params: {
      credential_id: credentialID,
    },
  })
}

export const fetchApiKeysList = ({ url, params }: { url: string, params: Record<string, any> }): Promise<ApiKeysListResponse> => {
  return get<ApiKeysListResponse>(url, params)
}

export const delApikey = ({ url, params }: { url: string, params: Record<string, any> }): Promise<CommonResponse> => {
  return del<CommonResponse>(url, params)
}

export const createApikey = ({ url, body }: { url: string, body: Record<string, any> }): Promise<CreateApiKeyResponse> => {
  return post<CreateApiKeyResponse>(url, body)
}

export const fetchDataSources = (): Promise<CommonResponse> => {
  return get<CommonResponse>('api-key-auth/data-source')
}

export const createDataSourceApiKeyBinding = (body: Record<string, any>): Promise<CommonResponse> => {
  return post<CommonResponse>('api-key-auth/data-source/binding', { body })
}

export const removeDataSourceApiKeyBinding = (id: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`api-key-auth/data-source/${id}`)
}

export const createFirecrawlTask = (body: Record<string, any>): Promise<CommonResponse> => {
  return post<CommonResponse>('website/crawl', {
    body: {
      ...body,
      provider: DataSourceProvider.fireCrawl,
    },
  })
}

export const checkFirecrawlTaskStatus = (jobId: string): Promise<CommonResponse> => {
  return get<CommonResponse>(`website/crawl/status/${jobId}`, {
    params: {
      provider: DataSourceProvider.fireCrawl,
    },
  }, {
    silent: true,
  })
}

export const createJinaReaderTask = (body: Record<string, any>): Promise<CommonResponse> => {
  return post<CommonResponse>('website/crawl', {
    body: {
      ...body,
      provider: DataSourceProvider.jinaReader,
    },
  })
}

export const checkJinaReaderTaskStatus = (jobId: string): Promise<CommonResponse> => {
  return get<CommonResponse>(`website/crawl/status/${jobId}`, {
    params: {
      provider: 'jinareader',
    },
  }, {
    silent: true,
  })
}

export const createWatercrawlTask = (body: Record<string, any>): Promise<CommonResponse> => {
  return post<CommonResponse>('website/crawl', {
    body: {
      ...body,
      provider: DataSourceProvider.waterCrawl,
    },
  })
}

export const checkWatercrawlTaskStatus = (jobId: string): Promise<CommonResponse> => {
  return get<CommonResponse>(`website/crawl/status/${jobId}`, {
    params: {
      provider: DataSourceProvider.waterCrawl,
    },
  }, {
    silent: true,
  })
}

export type FileTypesRes = {
  allowed_extensions: string[]
}

export const fetchSupportFileTypes = ({ url }: { url: string }): Promise<FileTypesRes> => {
  return get<FileTypesRes>(url)
}

export const getErrorDocs = ({ datasetId }: { datasetId: string }): Promise<ErrorDocsResponse> => {
  return get<ErrorDocsResponse>(`/datasets/${datasetId}/error-docs`)
}

export const retryErrorDocs = ({ datasetId, document_ids }: { datasetId: string, document_ids: string[] }): Promise<CommonResponse> => {
  return post<CommonResponse>(`/datasets/${datasetId}/retry`, { body: { document_ids } })
}

export const fetchDatasetApiBaseInfo = (): Promise<{ api_base_url: string }> => {
  return get<{ api_base_url: string }>('/datasets/api-base-info')
}

export const enableDatasetServiceApi = (datasetId: string): Promise<CommonResponse> => {
  return post<CommonResponse>(`/datasets/${datasetId}/api-keys/enable`)
}

export const disableDatasetServiceApi = (datasetId: string): Promise<CommonResponse> => {
  return post<CommonResponse>(`/datasets/${datasetId}/api-keys/disable`)
}

export const fetchDatasetApiKeys = (): Promise<ApiKeysListResponse> => {
  return get<ApiKeysListResponse>('/datasets/api-keys')
}

export const fetchExternalKnowledgeApiList = (): Promise<ExternalAPIListResponse> => {
  return get<ExternalAPIListResponse>('/datasets/external-knowledge-api')
}

export const fetchDatasetTestingRecords = (datasetId: string, params?: { page: number, limit: number }): Promise<HitTestingRecordsResponse> => {
  return get<HitTestingRecordsResponse>(`/datasets/${datasetId}/queries`, { params })
}

export const fetchDatasetErrorDocs = (datasetId: string): Promise<ErrorDocsResponse> => {
  return get<ErrorDocsResponse>(`/datasets/${datasetId}/error-docs`)
}

export const fetchDocumentList = (datasetId: string, params: { keyword: string, page: number, limit: number, sort?: string, status?: string }): Promise<DocumentListResponse> => {
  return get<DocumentListResponse>(`/datasets/${datasetId}/documents`, { params })
}

export const fetchAutoDisabledDocuments = (datasetId: string): Promise<{ document_ids: string[] }> => {
  return get<{ document_ids: string[] }>(`/datasets/${datasetId}/auto-disable-logs`)
}

const buildDocumentIdsQuery = (documentIds: string[] | string) => {
  const ids = Array.isArray(documentIds) ? documentIds : [documentIds]
  return ids.map(id => `document_id=${id}`).join('&')
}

export const updateDocumentStatusBatch = (datasetId: string, action: DocumentActionType, documentIds: string[] | string): Promise<CommonResponse> => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/status/${action}/batch?${buildDocumentIdsQuery(documentIds)}`)
}

export const deleteDocumentBatch = (datasetId: string, documentIds: string[] | string): Promise<CommonResponse> => {
  return del<CommonResponse>(`/datasets/${datasetId}/documents?${buildDocumentIdsQuery(documentIds)}`)
}

export const syncNotionDocument = (datasetId: string, documentId: string): Promise<CommonResponse> => {
  return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/notion/sync`)
}

export const syncWebsiteDocument = (datasetId: string, documentId: string): Promise<CommonResponse> => {
  return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/website-sync`)
}

export const fetchDocumentDetail = (datasetId: string, documentId: string, params?: { metadata?: string }): Promise<DocumentDetailResponse> => {
  return get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params })
}

export const retryDocumentBatch = (datasetId: string, documentIds: string[]): Promise<CommonResponse> => {
  return post<CommonResponse>(`/datasets/${datasetId}/retry`, {
    body: {
      document_ids: documentIds,
    },
  })
}

export const fetchDatasetMetadata = (datasetId: string): Promise<{ doc_metadata: MetadataItemWithValueLength[], built_in_field_enabled: boolean }> => {
  return get<{ doc_metadata: MetadataItemWithValueLength[], built_in_field_enabled: boolean }>(`/datasets/${datasetId}/metadata`)
}

export const createDatasetMetadata = (datasetId: string, payload: BuiltInMetadataItem): Promise<void> => {
  return post(`/datasets/${datasetId}/metadata`, {
    body: payload,
  }) as Promise<void>
}

export const updateDatasetMetadataName = (datasetId: string, metaDataId: string, name: string): Promise<void> => {
  return patch(`/datasets/${datasetId}/metadata/${metaDataId}`, {
    body: {
      name,
    },
  }) as Promise<void>
}

export const deleteDatasetMetadata = (datasetId: string, metaDataId: string): Promise<void> => {
  return del(`/datasets/${datasetId}/metadata/${metaDataId}`) as Promise<void>
}

export const fetchBuiltInMetadataFields = (): Promise<{ fields: BuiltInMetadataItem[] }> => {
  return get<{ fields: BuiltInMetadataItem[] }>('/datasets/metadata/built-in')
}

export const fetchDocumentMetadata = (datasetId: string, documentId: string): Promise<DocumentDetailResponse> => {
  return get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params: { metadata: 'only' } })
}

export const batchUpdateDocumentMetadata = (datasetId: string, metadataList: MetadataBatchEditToServer): Promise<void> => {
  return post(`/datasets/${datasetId}/documents/metadata`, {
    body: {
      operation_data: metadataList,
    },
  }) as Promise<void>
}

export const updateBuiltInMetadataStatus = (datasetId: string, enabled: boolean): Promise<void> => {
  return post(`/datasets/${datasetId}/metadata/built-in/${enabled ? 'enable' : 'disable'}`) as Promise<void>
}

export const fetchSegmentList = (datasetId: string, documentId: string, params: { page: number, limit: number, keyword: string, enabled: boolean | 'all' | '' }): Promise<SegmentsResponse> => {
  return get<SegmentsResponse>(`/datasets/${datasetId}/documents/${documentId}/segments`, { params })
}

export const updateSegment = (datasetId: string, documentId: string, segmentId: string, body: SegmentUpdater): Promise<{ data: SegmentDetailModel, doc_form: ChunkingMode }> => {
  return patch<{ data: SegmentDetailModel, doc_form: ChunkingMode }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`, { body })
}

export const addSegment = (datasetId: string, documentId: string, body: SegmentUpdater): Promise<{ data: SegmentDetailModel, doc_form: ChunkingMode }> => {
  return post<{ data: SegmentDetailModel, doc_form: ChunkingMode }>(`/datasets/${datasetId}/documents/${documentId}/segment`, { body })
}

export const enableSegments = (datasetId: string, documentId: string, segmentIds: string[]): Promise<CommonResponse> => {
  const query = segmentIds.map(id => `segment_id=${id}`).join('&')
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segment/enable?${query}`)
}

export const disableSegments = (datasetId: string, documentId: string, segmentIds: string[]): Promise<CommonResponse> => {
  const query = segmentIds.map(id => `segment_id=${id}`).join('&')
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segment/disable?${query}`)
}

export const deleteSegments = (datasetId: string, documentId: string, segmentIds: string[]): Promise<CommonResponse> => {
  const query = segmentIds.map(id => `segment_id=${id}`).join('&')
  return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments?${query}`)
}

export const fetchChildSegments = (datasetId: string, documentId: string, segmentId: string, params: { page: number, limit: number, keyword: string }): Promise<ChildSegmentsResponse> => {
  return get<ChildSegmentsResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`, { params })
}

export const deleteChildSegment = (datasetId: string, documentId: string, segmentId: string, childChunkId: string): Promise<CommonResponse> => {
  return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`)
}

export const addChildSegment = (datasetId: string, documentId: string, segmentId: string, body: { content: string }): Promise<{ data: ChildChunkDetail }> => {
  return post<{ data: ChildChunkDetail }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`, { body })
}

export const updateChildSegment = (datasetId: string, documentId: string, segmentId: string, childChunkId: string, body: { content: string }): Promise<{ data: ChildChunkDetail }> => {
  return patch<{ data: ChildChunkDetail }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`, { body })
}

export const batchImportSegments = (url: string, body: { upload_file_id: string }): Promise<BatchImportResponse> => {
  return post<BatchImportResponse>(url, { body })
}

export const checkSegmentBatchImportStatus = (jobID: string): Promise<BatchImportResponse> => {
  return get<BatchImportResponse>(`/datasets/batch_import_status/${jobID}`)
}
