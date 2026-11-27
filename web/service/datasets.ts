import type { DatasetUpdatePayload } from '@dify/contracts/api/console/datasets/types.gen'
import type { MutationFilters } from '@tanstack/react-query'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import type { FetchDatasetsParams } from '@/models/datasets'
import { isPlainObject } from 'es-toolkit/predicate'
import { DataSourceProvider } from '@/models/common'
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

export const fetchExternalAPI = ({ apiTemplateId }: { apiTemplateId: string }) => {
  return consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.get({
    params: { external_knowledge_api_id: apiTemplateId },
  })
}

export const createExternalKnowledgeBase = ({ body }: { body: CreateKnowledgeBaseReq }) => {
  return consoleClient.datasets.external.post({ body })
}

export const fetchIndexingStatus = ({ datasetId, documentId }: CommonDocReq) => {
  return consoleClient.datasets.byDatasetId.documents.byDocumentId.indexingStatus.get({
    params: { dataset_id: datasetId, document_id: documentId },
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
  return consoleClient.datasets.byDatasetId.documents.downloadZip.post({
    params: { dataset_id: datasetId },
    body: { document_ids: documentIds },
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
  consoleClient.website.crawl.status.byJobId.get({ params: { job_id: jobId }, query: { provider } })

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
