import type { Fetcher } from 'swr'
import qs from 'qs'
import { del, get, patch, post, put } from './base'
import type {
  CreateDocumentReq,
  DataSet,
  DataSetListResponse,
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
  createDocumentResponse,
} from '@/models/datasets'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { CommonResponse, DataSourceNotionWorkspace } from '@/models/common'
import { DataSourceProvider } from '@/models/common'
import type {
  ApiKeysListResponse,
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
    'name' | 'description' | 'permission' | 'partial_member_list' | 'indexing_technique' | 'retrieval_model' | 'embedding_model' | 'embedding_model_provider'
  >>
}> = ({ datasetId, body }) => {
  return patch<DataSet>(`/datasets/${datasetId}`, { body })
}

export const fetchDatasetRelatedApps: Fetcher<RelatedAppResponse, string> = (datasetId: string) => {
  return get<RelatedAppResponse>(`/datasets/${datasetId}/related-apps`)
}

export const fetchDatasets: Fetcher<DataSetListResponse, FetchDatasetsParams> = ({ url, params }) => {
  const urlParams = qs.stringify(params, { indices: false })
  return get<DataSetListResponse>(`${url}?${urlParams}`)
}

export const createEmptyDataset: Fetcher<DataSet, { name: string }> = ({ name }) => {
  return post<DataSet>('/datasets', { body: { name } })
}

export const checkIsUsedInApp: Fetcher<{ is_using: boolean }, string> = (id) => {
  return get<{ is_using: boolean }>(`/datasets/${id}/use-check`, {}, {
    silent: true,
  })
}

export const deleteDataset: Fetcher<DataSet, string> = (datasetID) => {
  return del<DataSet>(`/datasets/${datasetID}`)
}

export const fetchExternalAPIList: Fetcher<ExternalAPIListResponse, { url: string }> = ({ url }) => {
  return get<ExternalAPIListResponse>(url)
}

export const fetchExternalAPI: Fetcher<ExternalAPIItem, { apiTemplateId: string }> = ({ apiTemplateId }) => {
  return get<ExternalAPIItem>(`/datasets/external-knowledge-api/${apiTemplateId}`)
}

export const updateExternalAPI: Fetcher<ExternalAPIItem, { apiTemplateId: string; body: ExternalAPIItem }> = ({ apiTemplateId, body }) => {
  return patch<ExternalAPIItem>(`/datasets/external-knowledge-api/${apiTemplateId}`, { body })
}

export const deleteExternalAPI: Fetcher<ExternalAPIDeleteResponse, { apiTemplateId: string }> = ({ apiTemplateId }) => {
  return del<ExternalAPIDeleteResponse>(`/datasets/external-knowledge-api/${apiTemplateId}`)
}

export const checkUsageExternalAPI: Fetcher<ExternalAPIUsage, { apiTemplateId: string }> = ({ apiTemplateId }) => {
  return get<ExternalAPIUsage>(`/datasets/external-knowledge-api/${apiTemplateId}/use-check`)
}

export const createExternalAPI: Fetcher<ExternalAPIItem, { body: CreateExternalAPIReq }> = ({ body }) => {
  return post<ExternalAPIItem>('/datasets/external-knowledge-api', { body })
}

export const createExternalKnowledgeBase: Fetcher<ExternalKnowledgeItem, { body: CreateKnowledgeBaseReq }> = ({ body }) => {
  return post<ExternalKnowledgeItem>('/datasets/external', { body })
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

export const preImportNotionPages: Fetcher<{ notion_info: DataSourceNotionWorkspace[] }, { url: string; datasetId?: string }> = ({ url, datasetId }) => {
  return get<{ notion_info: DataSourceNotionWorkspace[] }>(url, { params: { dataset_id: datasetId } })
}

export const modifyDocMetadata: Fetcher<CommonResponse, CommonDocReq & { body: { doc_type: string; doc_metadata: Record<string, any> } }> = ({ datasetId, documentId, body }) => {
  return put<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/metadata`, { body })
}

// hit testing
export const hitTesting: Fetcher<HitTestingResponse, { datasetId: string; queryText: string; retrieval_model: RetrievalConfig }> = ({ datasetId, queryText, retrieval_model }) => {
  return post<HitTestingResponse>(`/datasets/${datasetId}/hit-testing`, { body: { query: queryText, retrieval_model } })
}

export const externalKnowledgeBaseHitTesting: Fetcher<ExternalKnowledgeBaseHitTestingResponse, { datasetId: string; query: string; external_retrieval_model: { top_k: number; score_threshold: number; score_threshold_enabled: boolean } }> = ({ datasetId, query, external_retrieval_model }) => {
  return post<ExternalKnowledgeBaseHitTestingResponse>(`/datasets/${datasetId}/external-hit-testing`, { body: { query, external_retrieval_model } })
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

export const fetchApiKeysList: Fetcher<ApiKeysListResponse, { url: string; params: Record<string, any> }> = ({ url, params }) => {
  return get<ApiKeysListResponse>(url, params)
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

export const fetchDataSources = () => {
  return get<CommonResponse>('api-key-auth/data-source')
}

export const createDataSourceApiKeyBinding: Fetcher<CommonResponse, Record<string, any>> = (body) => {
  return post<CommonResponse>('api-key-auth/data-source/binding', { body })
}

export const removeDataSourceApiKeyBinding: Fetcher<CommonResponse, string> = (id: string) => {
  return del<CommonResponse>(`api-key-auth/data-source/${id}`)
}

export const createFirecrawlTask: Fetcher<CommonResponse, Record<string, any>> = (body) => {
  return post<CommonResponse>('website/crawl', {
    body: {
      ...body,
      provider: DataSourceProvider.fireCrawl,
    },
  })
}

export const checkFirecrawlTaskStatus: Fetcher<CommonResponse, string> = (jobId: string) => {
  return get<CommonResponse>(`website/crawl/status/${jobId}`, {
    params: {
      provider: DataSourceProvider.fireCrawl,
    },
  }, {
    silent: true,
  })
}

export const createJinaReaderTask: Fetcher<CommonResponse, Record<string, any>> = (body) => {
  return post<CommonResponse>('website/crawl', {
    body: {
      ...body,
      provider: DataSourceProvider.jinaReader,
    },
  })
}

export const checkJinaReaderTaskStatus: Fetcher<CommonResponse, string> = (jobId: string) => {
  return get<CommonResponse>(`website/crawl/status/${jobId}`, {
    params: {
      provider: 'jinareader',
    },
  }, {
    silent: true,
  })
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
