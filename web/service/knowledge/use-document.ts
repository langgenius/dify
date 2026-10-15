import type { UseQueryOptions } from '@tanstack/react-query'
import type { DocumentDownloadZipRequest, MetadataType, SortType } from '../datasets'
import type {
  DocumentDetailResponse,
  DocumentListResponse,
  UpdateDocumentBatchParams,
} from '@/models/datasets'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'
import { DocumentActionType } from '@/models/datasets'
import { consoleClient } from '../console'
import { narrowResponse } from '../console/narrow-response'
import {
  downloadDocumentsZip,
  fetchDocumentDownloadUrl,
  pauseDocIndexing,
  resumeDocIndexing,
  retryErrorDocs,
} from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'knowledge/document'

export const useDocumentListKey = [NAME_SPACE, 'documentList']
type DocumentListRefetchInterval = UseQueryOptions<DocumentListResponse>['refetchInterval']

export const useDocumentList = (payload: {
  datasetId: string
  query: {
    keyword: string
    page: number
    limit: number
    sort?: SortType
    status?: string
  }
  refetchInterval?: DocumentListRefetchInterval
}) => {
  const { query, datasetId, refetchInterval } = payload
  const { keyword, page, limit, sort, status } = query
  const normalizedStatus = normalizeStatusForQuery(status)
  const params: { keyword: string; page: number; limit: number; sort?: string; status?: string } = {
    keyword,
    page,
    limit,
  }
  if (sort) params.sort = sort
  if (normalizedStatus && normalizedStatus !== 'all') params.status = normalizedStatus
  return useQuery<DocumentListResponse>({
    queryKey: [...useDocumentListKey, datasetId, params],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.byDatasetId.documents.get({
          params: { dataset_id: datasetId },
          query: params,
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval,
  })
}

export const useInvalidDocumentList = (datasetId?: string) => {
  return useInvalid(datasetId ? [...useDocumentListKey, datasetId] : useDocumentListKey)
}

const useAutoDisabledDocumentKey = [NAME_SPACE, 'autoDisabledDocument']
export const useAutoDisabledDocuments = (datasetId: string) => {
  return useQuery({
    queryKey: [...useAutoDisabledDocumentKey, datasetId],
    queryFn: () =>
      consoleClient.datasets.byDatasetId.autoDisableLogs.get({ params: { dataset_id: datasetId } }),
  })
}

export const useInvalidDisabledDocument = () => {
  return useInvalid(useAutoDisabledDocumentKey)
}

const toBatchDocumentIds = (documentIds: string[] | string) =>
  Array.isArray(documentIds) ? documentIds : [documentIds]

const useDocumentBatchAction = (action: DocumentActionType) => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return consoleClient.datasets.byDatasetId.documents.status.byAction.batch.patch({
        params: { dataset_id: datasetId, action },
        query: { document_id: toBatchDocumentIds(documentId || documentIds!) },
      })
    },
  })
}

export const useDocumentEnable = () => {
  return useDocumentBatchAction(DocumentActionType.enable)
}

export const useDocumentDisable = () => {
  return useDocumentBatchAction(DocumentActionType.disable)
}

export const useDocumentArchive = () => {
  return useDocumentBatchAction(DocumentActionType.archive)
}

export const useDocumentUnArchive = () => {
  return useDocumentBatchAction(DocumentActionType.unArchive)
}

export const useDocumentDelete = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return consoleClient.datasets.byDatasetId.documents.delete({
        params: { dataset_id: datasetId },
        query: { document_id: toBatchDocumentIds(documentId || documentIds!) },
      })
    },
  })
}

export const useSyncDocument = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!documentId) throw new Error('documentId is required')
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.notion.sync.get({
        params: { dataset_id: datasetId, document_id: documentId },
      })
    },
  })
}

export const useDocumentSummary = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return consoleClient.datasets.byDatasetId.documents.generateSummary.post({
        params: { dataset_id: datasetId },
        body: {
          document_list: toBatchDocumentIds(documentId || documentIds!),
        },
      })
    },
  })
}

export const useSyncWebsite = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!documentId) throw new Error('documentId is required')
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.websiteSync.get({
        params: { dataset_id: datasetId, document_id: documentId },
      })
    },
  })
}

const useDocumentDetailKey = [NAME_SPACE, 'documentDetail', 'withoutMetaData']
type DocumentDetailRefetchInterval = UseQueryOptions<DocumentDetailResponse>['refetchInterval']

export const useDocumentDetail = (payload: {
  datasetId: string
  documentId: string
  params: { metadata: MetadataType }
  refetchInterval?: DocumentDetailRefetchInterval
}) => {
  const { datasetId, documentId, params, refetchInterval } = payload
  return useQuery<DocumentDetailResponse>({
    queryKey: [...useDocumentDetailKey, 'withoutMetaData', datasetId, documentId, params],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.get({
          params: { dataset_id: datasetId, document_id: documentId },
          query: params,
        }),
      ),
    refetchInterval,
  })
}

export const useDocumentMetadata = (payload: {
  datasetId: string
  documentId: string
  params: { metadata: MetadataType }
}) => {
  const { datasetId, documentId, params } = payload
  return useQuery<DocumentDetailResponse>({
    queryKey: [...useDocumentDetailKey, 'onlyMetaData', datasetId, documentId, params],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.get({
          params: { dataset_id: datasetId, document_id: documentId },
          query: params,
        }),
      ),
  })
}

export const useInvalidDocumentDetail = () => {
  return useInvalid(useDocumentDetailKey)
}

export const useDocumentPause = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return pauseDocIndexing({ datasetId, documentId })
    },
  })
}

export const useDocumentResume = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return resumeDocIndexing({ datasetId, documentId })
    },
  })
}

export const useDocumentDownload = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return fetchDocumentDownloadUrl({ datasetId, documentId })
    },
  })
}

export const useDocumentDownloadZip = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds }: DocumentDownloadZipRequest) => {
      if (!datasetId || !documentIds?.length)
        throw new Error('datasetId and documentIds are required')
      return downloadDocumentsZip({ datasetId, documentIds })
    },
  })
}

export const useDocumentBatchRetryIndex = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds }: { datasetId: string; documentIds: string[] }) => {
      return retryErrorDocs({ datasetId, document_ids: documentIds })
    },
  })
}
