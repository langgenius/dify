import type { DatasetUpdatePayload } from '@dify/contracts/api/console/datasets/types.gen'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { FetchDatasetsParams } from '@/models/datasets'
import { DataSourceProvider } from '@/models/common'
// oxlint-disable-next-line no-restricted-imports -- the zip download needs the raw Blob response
import { post } from './base'
import { consoleClient } from './console'

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
}) => {
  return consoleClient.datasets.byDatasetId.patch({ params: { dataset_id: datasetId }, body })
}

export const fetchDatasets = ({ params }: FetchDatasetsParams) => {
  return consoleClient.datasets.get({ query: params })
}

export const createEmptyDataset = ({ name }: { name: string }) => {
  return consoleClient.datasets.post({ body: { name } })
}

export const checkIsUsedInApp = (id: string) => {
  return consoleClient.datasets.byDatasetId.useCheck.get(
    { params: { dataset_id: id } },
    { context: { silent: true } },
  )
}

export const deleteDataset = (datasetID: string) => {
  return consoleClient.datasets.byDatasetId.delete({ params: { dataset_id: datasetID } })
}

export const fetchExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const updateExternalAPI = ({
  apiTemplateId,
  body,
}: {
  apiTemplateId: string
  body: CreateExternalAPIReq
}) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch({
    params: { external_knowledge_api_id: apiTemplateId },
    body,
  })
}

export const deleteExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.delete({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const checkUsageExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.useCheck.get({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const createExternalAPI = ({ body }: { body: CreateExternalAPIReq }) => {
  return consoleClient.datasets.externalKnowledgeApi.post({ body })
}

export const createExternalKnowledgeBase = ({ body }: { body: CreateKnowledgeBaseReq }) => {
  return consoleClient.datasets.external.post({ body })
}

export const fetchIndexingStatus = ({ datasetId, documentId }: CommonDocReq) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.indexingStatus.get({
    params: { dataset_id: datasetId, document_id: documentId },
  })
}

export const fetchIndexingStatusBatch = ({ datasetId, batchId }: BatchReq) => {
  return consoleClient.datasets.byDatasetId.batch.byBatch.indexingStatus.get({
    params: { dataset_id: datasetId, batch: batchId },
  })
}

export const renameDocumentName = ({
  datasetId,
  documentId,
  name,
}: CommonDocReq & { name: string }) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.rename.post({
    params: { dataset_id: datasetId, document_id: documentId },
    body: { name },
  })
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
