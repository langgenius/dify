import type { Fetcher } from 'swr'
import qs from 'qs'
import { del, get, patch, post, put } from './base'
import type {
  CreateDocumentReq,
  DataSet,
  DataSetListResponse,
  DocumentDetailResponse,
  DocumentListResponse,
  ErrorDocsResponse,
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
  SegmentUpdator,
  SegmentsQuery,
  SegmentsResponse,
  createDocumentResponse,
} from '@/models/datasets'
import type { CommonResponse, DataSourceNotionWorkspace } from '@/models/common'
import type {
  ApikeysListResponse,
  CreateApiKeyResponse,
} from '@/models/app'
import type { RetrievalConfig } from '@/types/app'

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

export const fetchDatasetDetail: Fetcher<DataSet, string> = (datasetId: string) => {
  return get<DataSet>(`/datasets/${datasetId}`)
}

export const updateDatasetSetting: Fetcher<DataSet, {
  datasetId: string
  body: Partial<Pick<DataSet,
    'name' | 'description' | 'permission' | 'indexing_technique' | 'retrieval_model' | 'embedding_model' | 'embedding_model_provider'
  >>
}> = ({ datasetId, body }) => {
  return patch<DataSet>(`/datasets/${datasetId}`, { body })
}

export const fetchDatasetRelatedApps: Fetcher<RelatedAppResponse, string> = (datasetId: string) => {
  return get<RelatedAppResponse>(`/datasets/${datasetId}/related-apps`)
}

export const fetchDatasets: Fetcher<DataSetListResponse, { url: string; params: { page: number; ids?: string[]; limit?: number } }> = ({ url, params }) => {
  const urlParams = qs.stringify(params, { indices: false })
  return get<DataSetListResponse>(`${url}?${urlParams}`)
}

export const createEmptyDataset: Fetcher<DataSet, { name: string }> = ({ name }) => {
  return post<DataSet>('/datasets', { body: { name } })
}

export const deleteDataset: Fetcher<DataSet, string> = (datasetID) => {
  return del<DataSet>(`/datasets/${datasetID}`)
}

export const fetchDefaultProcessRule: Fetcher<ProcessRuleResponse, { url: string }> = ({ url }) => {
  return get<ProcessRuleResponse>(url)
}
export const fetchProcessRule: Fetcher<ProcessRuleResponse, { params: { documentId: string } }> = ({ params: { documentId } }) => {
  return get<ProcessRuleResponse>('/datasets/process-rule', { params: { document_id: documentId } })
}

export const fetchDocuments: Fetcher<DocumentListResponse, { datasetId: string; params: { keyword: string; page: number; limit: number; sort?: SortType } }> = ({ datasetId, params }) => {
  return get<DocumentListResponse>(`/datasets/${datasetId}/documents`, { params })
}

export const createFirstDocument: Fetcher<createDocumentResponse, { body: CreateDocumentReq }> = ({ body }) => {
  return post<createDocumentResponse>('/datasets/init', { body })
}

export const createDocument: Fetcher<createDocumentResponse, { datasetId: string; body: CreateDocumentReq }> = ({ datasetId, body }) => {
  return post<createDocumentResponse>(`/datasets/${datasetId}/documents`, { body })
}

export const fetchIndexingEstimate: Fetcher<IndexingEstimateResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get<IndexingEstimateResponse>(`/datasets/${datasetId}/documents/${documentId}/indexing-estimate`, {})
}
export const fetchIndexingEstimateBatch: Fetcher<IndexingEstimateResponse, BatchReq> = ({ datasetId, batchId }) => {
  return get<IndexingEstimateResponse>(`/datasets/${datasetId}/batch/${batchId}/indexing-estimate`, {})
}

export const fetchIndexingStatus: Fetcher<IndexingStatusResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get<IndexingStatusResponse>(`/datasets/${datasetId}/documents/${documentId}/indexing-status`, {})
}

export const fetchIndexingStatusBatch: Fetcher<IndexingStatusBatchResponse, BatchReq> = ({ datasetId, batchId }) => {
  return get<IndexingStatusBatchResponse>(`/datasets/${datasetId}/batch/${batchId}/indexing-status`, {})
}

export const fetchDocumentDetail: Fetcher<DocumentDetailResponse, CommonDocReq & { params: { metadata?: MetadataType } }> = ({ datasetId, documentId, params }) => {
  return get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params })
}

export const renameDocumentName: Fetcher<CommonResponse, CommonDocReq & { name: string }> = ({ datasetId, documentId, name }) => {
  return post<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/rename`, {
    body: { name },
  })
}

export const pauseDocIndexing: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/processing/pause`)
}

export const resumeDocIndexing: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/processing/resume`)
}

export const deleteDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}`)
}

export const archiveDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/status/archive`)
}

export const unArchiveDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/status/un_archive`)
}

export const enableDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/status/enable`)
}

export const disableDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/status/disable`)
}

export const syncDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/notion/sync`)
}

export const preImportNotionPages: Fetcher<{ notion_info: DataSourceNotionWorkspace[] }, { url: string; datasetId?: string }> = ({ url, datasetId }) => {
  return get<{ notion_info: DataSourceNotionWorkspace[] }>(url, { params: { dataset_id: datasetId } })
}

export const modifyDocMetadata: Fetcher<CommonResponse, CommonDocReq & { body: { doc_type: string; doc_metadata: Record<string, any> } }> = ({ datasetId, documentId, body }) => {
  return put<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/metadata`, { body })
}

// apis for segments in a document

export const fetchSegments: Fetcher<SegmentsResponse, CommonDocReq & { params: SegmentsQuery }> = ({ datasetId, documentId, params }) => {
  return get<SegmentsResponse>(`/datasets/${datasetId}/documents/${documentId}/segments`, { params })
}

export const enableSegment: Fetcher<CommonResponse, { datasetId: string; segmentId: string }> = ({ datasetId, segmentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/segments/${segmentId}/enable`)
}

export const disableSegment: Fetcher<CommonResponse, { datasetId: string; segmentId: string }> = ({ datasetId, segmentId }) => {
  return patch<CommonResponse>(`/datasets/${datasetId}/segments/${segmentId}/disable`)
}

export const updateSegment: Fetcher<{ data: SegmentDetailModel; doc_form: string }, { datasetId: string; documentId: string; segmentId: string; body: SegmentUpdator }> = ({ datasetId, documentId, segmentId, body }) => {
  return patch<{ data: SegmentDetailModel; doc_form: string }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`, { body })
}

export const addSegment: Fetcher<{ data: SegmentDetailModel; doc_form: string }, { datasetId: string; documentId: string; body: SegmentUpdator }> = ({ datasetId, documentId, body }) => {
  return post<{ data: SegmentDetailModel; doc_form: string }>(`/datasets/${datasetId}/documents/${documentId}/segment`, { body })
}

export const deleteSegment: Fetcher<CommonResponse, { datasetId: string; documentId: string; segmentId: string }> = ({ datasetId, documentId, segmentId }) => {
  return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`)
}

export const segmentBatchImport: Fetcher<{ job_id: string; job_status: string }, { url: string; body: FormData }> = ({ url, body }) => {
  return post<{ job_id: string; job_status: string }>(url, { body }, { bodyStringify: false, deleteContentType: true })
}

export const checkSegmentBatchImportProgress: Fetcher<{ job_id: string; job_status: string }, { jobID: string }> = ({ jobID }) => {
  return get<{ job_id: string; job_status: string }>(`/datasets/batch_import_status/${jobID}`)
}

// hit testing
export const hitTesting: Fetcher<HitTestingResponse, { datasetId: string; queryText: string; retrieval_model: RetrievalConfig }> = ({ datasetId, queryText, retrieval_model }) => {
  return post<HitTestingResponse>(`/datasets/${datasetId}/hit-testing`, { body: { query: queryText, retrieval_model } })
}

export const fetchTestingRecords: Fetcher<HitTestingRecordsResponse, { datasetId: string; params: { page: number; limit: number } }> = ({ datasetId, params }) => {
  return get<HitTestingRecordsResponse>(`/datasets/${datasetId}/queries`, { params })
}

export const fetchFileIndexingEstimate: Fetcher<FileIndexingEstimateResponse, IndexingEstimateParams> = (body: IndexingEstimateParams) => {
  return post<FileIndexingEstimateResponse>('/datasets/indexing-estimate', { body })
}

export const fetchNotionPagePreview: Fetcher<{ content: string }, { workspaceID: string; pageID: string; pageType: string }> = ({ workspaceID, pageID, pageType }) => {
  return get<{ content: string }>(`notion/workspaces/${workspaceID}/pages/${pageID}/${pageType}/preview`)
}

export const fetchApiKeysList: Fetcher<ApikeysListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<ApikeysListResponse>(url, params)
}

export const delApikey: Fetcher<CommonResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return del<CommonResponse>(url, params)
}

export const createApikey: Fetcher<CreateApiKeyResponse, { url: string; body: Record<string, any> }> = ({ url, body }) => {
  return post<CreateApiKeyResponse>(url, body)
}

export const fetchDatasetApiBaseUrl: Fetcher<{ api_base_url: string }, string> = (url) => {
  return get<{ api_base_url: string }>(url)
}

type FileTypesRes = {
  allowed_extensions: string[]
}

export const fetchSupportFileTypes: Fetcher<FileTypesRes, { url: string }> = ({ url }) => {
  return get<FileTypesRes>(url)
}

export const getErrorDocs: Fetcher<ErrorDocsResponse, { datasetId: string }> = ({ datasetId }) => {
  return get<ErrorDocsResponse>(`/datasets/${datasetId}/error-docs`)
}

export const retryErrorDocs: Fetcher<CommonResponse, { datasetId: string; document_ids: string[] }> = ({ datasetId, document_ids }) => {
  return post<CommonResponse>(`/datasets/${datasetId}/retry`, { body: { document_ids } })
}
