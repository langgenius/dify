import type { Fetcher } from 'swr'
import qs from 'qs'
import { del, get, patch, post, put } from './base'
import type { CreateDocumentReq, DataSet, DataSetListResponse, DocumentDetailResponse, DocumentListResponse, FileIndexingEstimateResponse, HitTestingRecordsResponse, HitTestingResponse, IndexingEstimateResponse, IndexingStatusBatchResponse, IndexingStatusResponse, ProcessRuleResponse, RelatedAppResponse, SegmentsQuery, SegmentsResponse, createDocumentResponse } from '@/models/datasets'
import type { CommonResponse, DataSourceNotionWorkspace } from '@/models/common'

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

export const fetchDataDetail: Fetcher<DataSet, string> = (datasetId: string) => {
  return get(`/datasets/${datasetId}`) as Promise<DataSet>
}

export const updateDatasetSetting: Fetcher<DataSet, { datasetId: string; body: Partial<Pick<DataSet, 'name' | 'description' | 'permission' | 'indexing_technique'>> }> = ({ datasetId, body }) => {
  return patch(`/datasets/${datasetId}`, { body }) as Promise<DataSet>
}

export const fetchDatasetRelatedApps: Fetcher<RelatedAppResponse, string> = (datasetId: string) => {
  return get(`/datasets/${datasetId}/related-apps`) as Promise<RelatedAppResponse>
}

export const fetchDatasets: Fetcher<DataSetListResponse, { url: string; params: { page: number; ids?: string[]; limit?: number } }> = ({ url, params }) => {
  const urlParams = qs.stringify(params, { indices: false })
  return get(`${url}?${urlParams}`) as Promise<DataSetListResponse>
}

export const createEmptyDataset: Fetcher<DataSet, { name: string }> = ({ name }) => {
  return post('/datasets', { body: { name } }) as Promise<DataSet>
}

export const deleteDataset: Fetcher<DataSet, string> = (datasetID) => {
  return del(`/datasets/${datasetID}`) as Promise<DataSet>
}

export const fetchDefaultProcessRule: Fetcher<ProcessRuleResponse, { url: string }> = ({ url }) => {
  return get(url) as Promise<ProcessRuleResponse>
}
export const fetchProcessRule: Fetcher<ProcessRuleResponse, { params: { documentId: string } }> = ({ params: { documentId } }) => {
  return get('/datasets/process-rule', { params: { document_id: documentId } }) as Promise<ProcessRuleResponse>
}

export const fetchDocuments: Fetcher<DocumentListResponse, { datasetId: string; params: { keyword: string; page: number; limit: number; sort?: SortType } }> = ({ datasetId, params }) => {
  return get(`/datasets/${datasetId}/documents`, { params }) as Promise<DocumentListResponse>
}

export const createFirstDocument: Fetcher<createDocumentResponse, { body: CreateDocumentReq }> = ({ body }) => {
  return post('/datasets/init', { body }) as Promise<createDocumentResponse>
}

export const createDocument: Fetcher<createDocumentResponse, { datasetId: string; body: CreateDocumentReq }> = ({ datasetId, body }) => {
  return post(`/datasets/${datasetId}/documents`, { body }) as Promise<createDocumentResponse>
}

export const fetchIndexingEstimate: Fetcher<IndexingEstimateResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get(`/datasets/${datasetId}/documents/${documentId}/indexing-estimate`, {}) as Promise<IndexingEstimateResponse>
}
export const fetchIndexingEstimateBatch: Fetcher<IndexingEstimateResponse, BatchReq> = ({ datasetId, batchId }) => {
  return get(`/datasets/${datasetId}/batch/${batchId}/indexing-estimate`, {}) as Promise<IndexingEstimateResponse>
}

export const fetchIndexingStatus: Fetcher<IndexingStatusResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get(`/datasets/${datasetId}/documents/${documentId}/indexing-status`, {}) as Promise<IndexingStatusResponse>
}

export const fetchIndexingStatusBatch: Fetcher<IndexingStatusBatchResponse, BatchReq> = ({ datasetId, batchId }) => {
  return get(`/datasets/${datasetId}/batch/${batchId}/indexing-status`, {}) as Promise<IndexingStatusBatchResponse>
}

export const fetchDocumentDetail: Fetcher<DocumentDetailResponse, CommonDocReq & { params: { metadata?: MetadataType } }> = ({ datasetId, documentId, params }) => {
  return get(`/datasets/${datasetId}/documents/${documentId}`, { params }) as Promise<DocumentDetailResponse>
}

export const pauseDocIndexing: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch(`/datasets/${datasetId}/documents/${documentId}/processing/pause`) as Promise<CommonResponse>
}

export const resumeDocIndexing: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch(`/datasets/${datasetId}/documents/${documentId}/processing/resume`) as Promise<CommonResponse>
}

export const deleteDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return del(`/datasets/${datasetId}/documents/${documentId}`) as Promise<CommonResponse>
}

export const archiveDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch(`/datasets/${datasetId}/documents/${documentId}/status/archive`) as Promise<CommonResponse>
}

export const enableDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch(`/datasets/${datasetId}/documents/${documentId}/status/enable`) as Promise<CommonResponse>
}

export const disableDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return patch(`/datasets/${datasetId}/documents/${documentId}/status/disable`) as Promise<CommonResponse>
}

export const syncDocument: Fetcher<CommonResponse, CommonDocReq> = ({ datasetId, documentId }) => {
  return get(`/datasets/${datasetId}/documents/${documentId}/notion/sync`) as Promise<CommonResponse>
}

export const preImportNotionPages: Fetcher<{ notion_info: DataSourceNotionWorkspace[] }, { url: string; datasetId?: string }> = ({ url, datasetId }) => {
  return get(url, { params: { dataset_id: datasetId } }) as Promise<{ notion_info: DataSourceNotionWorkspace[] }>
}

export const modifyDocMetadata: Fetcher<CommonResponse, CommonDocReq & { body: { doc_type: string; doc_metadata: Record<string, any> } }> = ({ datasetId, documentId, body }) => {
  return put(`/datasets/${datasetId}/documents/${documentId}/metadata`, { body }) as Promise<CommonResponse>
}

export const getDatasetIndexingStatus: Fetcher<{ data: IndexingStatusResponse[] }, string> = (datasetId) => {
  return get(`/datasets/${datasetId}/indexing-status`) as Promise<{ data: IndexingStatusResponse[] }>
}

// apis for segments in a document

export const fetchSegments: Fetcher<SegmentsResponse, CommonDocReq & { params: SegmentsQuery }> = ({ datasetId, documentId, params }) => {
  return get(`/datasets/${datasetId}/documents/${documentId}/segments`, { params }) as Promise<SegmentsResponse>
}

export const enableSegment: Fetcher<CommonResponse, { datasetId: string; segmentId: string }> = ({ datasetId, segmentId }) => {
  return patch(`/datasets/${datasetId}/segments/${segmentId}/enable`) as Promise<CommonResponse>
}

export const disableSegment: Fetcher<CommonResponse, { datasetId: string; segmentId: string }> = ({ datasetId, segmentId }) => {
  return patch(`/datasets/${datasetId}/segments/${segmentId}/disable`) as Promise<CommonResponse>
}

// hit testing
export const hitTesting: Fetcher<HitTestingResponse, { datasetId: string; queryText: string }> = ({ datasetId, queryText }) => {
  return post(`/datasets/${datasetId}/hit-testing`, { body: { query: queryText } }) as Promise<HitTestingResponse>
}

export const fetchTestingRecords: Fetcher<HitTestingRecordsResponse, { datasetId: string; params: { page: number; limit: number } }> = ({ datasetId, params }) => {
  return get(`/datasets/${datasetId}/queries`, { params }) as Promise<HitTestingRecordsResponse>
}

export const fetchFileIndexingEstimate: Fetcher<FileIndexingEstimateResponse, any> = (body: any) => {
  return post('/datasets/indexing-estimate', { body }) as Promise<FileIndexingEstimateResponse>
}

export const fetchNotionPagePreview: Fetcher<{ content: string }, { workspaceID: string; pageID: string; pageType: string }> = ({ workspaceID, pageID, pageType }) => {
  return get(`notion/workspaces/${workspaceID}/pages/${pageID}/${pageType}/preview`) as Promise<{ content: string }>
}
