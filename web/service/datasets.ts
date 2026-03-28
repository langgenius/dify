import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type {
  ApiKeysListResponse,
  CreateApiKeyResponse,
} from '@/models/app'
import type { CommonResponse, DataSourceNotionWorkspace } from '@/models/common'
import type {
  CreateDocumentReq,
  createDocumentResponse,
  DataSet,
  DataSetListResponse,
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

export type DocumentDownloadResponse = {
  url: string
}

export type DocumentDownloadZipRequest = {
  datasetId: string
  documentIds: string[]
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

export const fetchDocumentDownloadUrl = ({ datasetId, documentId }: CommonDocReq): Promise<DocumentDownloadResponse> => {
  return get<DocumentDownloadResponse>(`/datasets/${datasetId}/documents/${documentId}/download`, {})
}

export const downloadDocumentsZip = ({ datasetId, documentIds }: DocumentDownloadZipRequest): Promise<Blob> => {
  return post<Blob>(`/datasets/${datasetId}/documents/download-zip`, {
    body: {
      document_ids: documentIds,
    },
  })
}

export const preImportNotionPages = ({ url, datasetId }: { url: string, datasetId?: string }): Promise<{ notion_info: DataSourceNotionWorkspace[] }> => {
  return get<{ notion_info: DataSourceNotionWorkspace[] }>(url, { params: { dataset_id: datasetId } })
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
