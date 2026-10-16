import type {
  DatasetUpdatePayload,
  IndexingEstimatePayload,
  KnowledgeConfig,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { CommonResponse } from '@/models/common'
import type {
  createDocumentResponse,
  DataSet,
  DataSetListResponse,
  ExternalAPIItem,
  ExternalAPIUsage,
  ExternalKnowledgeItem,
  FetchDatasetsParams,
  FileIndexingEstimateResponse,
  IndexingStatusBatchResponse,
  IndexingStatusResponse,
  ProcessRuleResponse,
} from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'
// oxlint-disable-next-line no-restricted-imports -- the zip download needs the raw Blob response
import { post } from './base'
import { consoleClient } from './console'
import { narrowResponse } from './console/narrow-response'

// apis for documents in a dataset

type CommonDocReq = {
  datasetId: string
  documentId: string
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

export const updateDatasetSetting = ({
  datasetId,
  body,
}: {
  datasetId: string
  body: DatasetUpdatePayload
}): Promise<DataSet> => {
  return narrowResponse(
    consoleClient.datasets.byDatasetId.patch({ params: { dataset_id: datasetId }, body }),
  )
}

export const fetchDatasets = ({ params }: FetchDatasetsParams): Promise<DataSetListResponse> => {
  return narrowResponse(consoleClient.datasets.get({ query: params }))
}

export const createEmptyDataset = ({ name }: { name: string }): Promise<DataSet> => {
  return narrowResponse(consoleClient.datasets.post({ body: { name } }))
}

export const checkIsUsedInApp = (id: string): Promise<{ is_using: boolean }> => {
  return consoleClient.datasets.byDatasetId.useCheck.get(
    { params: { dataset_id: id } },
    { context: { silent: true } },
  )
}

export const deleteDataset = (datasetID: string) => {
  return consoleClient.datasets.byDatasetId.delete({ params: { dataset_id: datasetID } })
}

export const fetchExternalAPI = ({
  apiTemplateId,
}: {
  apiTemplateId: string
}): Promise<ExternalAPIItem> => {
  return narrowResponse(
    consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get({
      params: { external_knowledge_api_id: apiTemplateId },
    }),
  )
}

export const updateExternalAPI = ({
  apiTemplateId,
  body,
}: {
  apiTemplateId: string
  body: ExternalAPIItem
}): Promise<ExternalAPIItem> => {
  return narrowResponse(
    consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch({
      params: { external_knowledge_api_id: apiTemplateId },
      body,
    }),
  )
}

export const deleteExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.delete({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const checkUsageExternalAPI = ({
  apiTemplateId,
}: {
  apiTemplateId: string
}): Promise<ExternalAPIUsage> => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.useCheck.get({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const createExternalAPI = ({
  body,
}: {
  body: CreateExternalAPIReq
}): Promise<ExternalAPIItem> => {
  return narrowResponse(consoleClient.datasets.externalKnowledgeApi.post({ body }))
}

export const createExternalKnowledgeBase = ({
  body,
}: {
  body: CreateKnowledgeBaseReq
}): Promise<ExternalKnowledgeItem> => {
  return narrowResponse(consoleClient.datasets.external.post({ body }))
}

export const fetchDefaultProcessRule = (): Promise<ProcessRuleResponse> => {
  return narrowResponse(consoleClient.datasets.processRule.get({}))
}

export const createFirstDocument = ({
  body,
}: {
  body: KnowledgeConfig
}): Promise<createDocumentResponse> => {
  return narrowResponse(consoleClient.datasets.init.post({ body }))
}

export const createDocument = ({
  datasetId,
  body,
}: {
  datasetId: string
  body: KnowledgeConfig
}): Promise<createDocumentResponse> => {
  return narrowResponse(
    consoleClient.datasets.byDatasetId.documents.post({ params: { dataset_id: datasetId }, body }),
  )
}

export const fetchIndexingStatus = ({
  datasetId,
  documentId,
}: CommonDocReq): Promise<IndexingStatusResponse> => {
  return narrowResponse(
    consoleClient.datasets.byDatasetId.documents.byDocumentId.indexingStatus.get({
      params: { dataset_id: datasetId, document_id: documentId },
    }),
  )
}

export const fetchIndexingStatusBatch = ({
  datasetId,
  batchId,
}: BatchReq): Promise<IndexingStatusBatchResponse> => {
  return narrowResponse(
    consoleClient.datasets.byDatasetId.batch.byBatch.indexingStatus.get({
      params: { dataset_id: datasetId, batch: batchId },
    }),
  )
}

export const renameDocumentName = ({
  datasetId,
  documentId,
  name,
}: CommonDocReq & { name: string }): Promise<CommonResponse> => {
  return narrowResponse(
    consoleClient.datasets.byDatasetId.documents.byDocumentId.rename.post({
      params: { dataset_id: datasetId, document_id: documentId },
      body: { name },
    }),
  )
}

export const pauseDocIndexing = ({ datasetId, documentId }: CommonDocReq) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.processing.pause.patch({
    params: { dataset_id: datasetId, document_id: documentId },
  })
}

export const resumeDocIndexing = ({ datasetId, documentId }: CommonDocReq) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.processing.resume.patch({
    params: { dataset_id: datasetId, document_id: documentId },
  })
}

// Not migrated to the console contract: the endpoint streams a zip file, which the
// JSON-based console client cannot return as a Blob.
export const downloadDocumentsZip = ({
  datasetId,
  documentIds,
}: DocumentDownloadZipRequest): Promise<Blob> => {
  return post<Blob>(`/datasets/${datasetId}/documents/download-zip`, {
    body: {
      document_ids: documentIds,
    },
  })
}

// hit testing
export const fetchFileIndexingEstimate = (
  body: IndexingEstimatePayload,
): Promise<FileIndexingEstimateResponse> => {
  return narrowResponse(consoleClient.datasets.indexingEstimate.post({ body }))
}

export const fetchNotionPagePreview = ({
  pageID,
  pageType,
  credentialID,
}: {
  pageID: string
  pageType: string
  credentialID: string
}): Promise<{ content: string }> => {
  return consoleClient.notion.pages.byPageId.byPageType.preview.get({
    params: { page_id: pageID, page_type: pageType },
    query: { credential_id: credentialID },
  })
}

type WebsiteCrawlProvider = 'firecrawl' | 'jinareader' | 'watercrawl'

type WebsiteCrawlTaskBody = {
  url: string
  options: Record<string, unknown>
}

const createWebsiteCrawlTask = (provider: WebsiteCrawlProvider, body: WebsiteCrawlTaskBody) =>
  consoleClient.website.crawl.post({ body: { ...body, provider } })

const checkWebsiteCrawlTaskStatus = (provider: WebsiteCrawlProvider, jobId: string) =>
  consoleClient.website.crawl.status.byJobId.get(
    { params: { job_id: jobId }, query: { provider } },
    { context: { silent: true } },
  )

export const createFirecrawlTask = (body: WebsiteCrawlTaskBody) =>
  createWebsiteCrawlTask(DataSourceProvider.fireCrawl, body)

export const checkFirecrawlTaskStatus = (jobId: string) =>
  checkWebsiteCrawlTaskStatus(DataSourceProvider.fireCrawl, jobId)

export const createJinaReaderTask = (body: WebsiteCrawlTaskBody) =>
  createWebsiteCrawlTask(DataSourceProvider.jinaReader, body)

export const checkJinaReaderTaskStatus = (jobId: string) =>
  checkWebsiteCrawlTaskStatus(DataSourceProvider.jinaReader, jobId)

export const createWatercrawlTask = (body: WebsiteCrawlTaskBody) =>
  createWebsiteCrawlTask(DataSourceProvider.waterCrawl, body)

export const checkWatercrawlTaskStatus = (jobId: string) =>
  checkWebsiteCrawlTaskStatus(DataSourceProvider.waterCrawl, jobId)

export const retryErrorDocs = ({
  datasetId,
  document_ids,
}: {
  datasetId: string
  document_ids: string[]
}) => {
  return consoleClient.datasets.byDatasetId.retry.post({
    params: { dataset_id: datasetId },
    body: { document_ids },
  })
}
