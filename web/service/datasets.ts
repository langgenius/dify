import type { DatasetUpdatePayload } from '@dify/contracts/api/console/datasets/types.gen'
import type { MutationFilters } from '@tanstack/react-query'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { FetchDatasetsParams } from '@/models/datasets'
import type { ConsoleClientContext } from '@/service/console'
import { isPlainObject } from 'es-toolkit/predicate'
import { DataSourceProvider } from '@/models/common'
// oxlint-disable-next-line no-restricted-imports -- the zip download needs the raw Blob response
import { post } from './base'
import { consoleClient, consoleQuery } from './console'

export function documentRenameFilter(datasetId: string, documentId: string): MutationFilters {
  return {
    mutationKey: consoleQuery.datasets.byDatasetId.documents.byDocumentId.rename.post.mutationKey(),
    predicate: ({ state: { variables } }) =>
      isPlainObject(variables) &&
      variables.params?.dataset_id === datasetId &&
      variables.params?.document_id === documentId,
  }
}

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

export const updateDatasetSetting = (
  {
    datasetId,
    body,
  }: {
    datasetId: string
    body: DatasetUpdatePayload
  },
  context?: ConsoleClientContext,
) => {
  return consoleClient.datasets.byDatasetId.patch(
    { params: { dataset_id: datasetId }, body },
    { context },
  )
}

export const fetchDatasets = ({ params }: FetchDatasetsParams) => {
  return consoleClient.datasets.get({ query: params })
}

export const createEmptyDataset = ({ name }: { name: string }, context?: ConsoleClientContext) => {
  return consoleClient.datasets.post({ body: { name } }, { context })
}

export const fetchExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get(
    { params: { external_knowledge_api_id: apiTemplateId } },
    { context: { silent: true } },
  )
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

export const createExternalKnowledgeBase = (
  { body }: { body: CreateKnowledgeBaseReq },
  context?: ConsoleClientContext,
) => {
  return consoleClient.datasets.external.post({ body }, { context })
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

export const pauseDocIndexing = (
  { datasetId, documentId }: CommonDocReq,
  context?: ConsoleClientContext,
) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.processing.pause.patch(
    {
      params: { dataset_id: datasetId, document_id: documentId },
    },
    { context },
  )
}

export const resumeDocIndexing = (
  { datasetId, documentId }: CommonDocReq,
  context?: ConsoleClientContext,
) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.processing.resume.patch(
    {
      params: { dataset_id: datasetId, document_id: documentId },
    },
    { context },
  )
}

// Not migrated to the console contract: the endpoint streams a zip file, which the
// JSON-based console client cannot return as a Blob.
export const downloadDocumentsZip = (
  { datasetId, documentIds }: DocumentDownloadZipRequest,
  options?: { silent?: boolean },
): Promise<Blob> => {
  return post<Blob>(
    `/datasets/${datasetId}/documents/download-zip`,
    {
      body: {
        document_ids: documentIds,
      },
    },
    options,
  )
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
