import type { UseQueryOptions } from '@tanstack/react-query'
import type {
  DocumentDownloadResponse,
  DocumentDownloadZipRequest,
  MetadataType,
  SortType,
} from '../datasets'
import type { CommonResponse } from '@/models/common'
import type {
  DocumentDetailResponse,
  DocumentListResponse,
  UpdateDocumentBatchParams,
} from '@/models/datasets'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'
import { DocumentActionType } from '@/models/datasets'
import { del, get, patch, post } from '../base'
import {
  downloadDocumentsZip,
  fetchDocumentDownloadUrl,
  pauseDocIndexing,
  resumeDocIndexing,
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
  const params: Record<string, number | string> = {
    keyword,
    page,
    limit,
  }
  if (sort) params.sort = sort
  if (normalizedStatus && normalizedStatus !== 'all') params.status = normalizedStatus
  return useQuery<DocumentListResponse>({
    queryKey: [...useDocumentListKey, datasetId, params],
    queryFn: () =>
      get<DocumentListResponse>(`/datasets/${datasetId}/documents`, {
        params,
      }),
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
    queryFn: () => get<{ document_ids: string[] }>(`/datasets/${datasetId}/auto-disable-logs`),
  })
}

export const useInvalidDisabledDocument = () => {
  return useInvalid(useAutoDisabledDocumentKey)
}

const toBatchDocumentsIdParams = (documentIds: string[] | string) => {
  const ids = Array.isArray(documentIds) ? documentIds : [documentIds]
  return ids.map((id) => `document_id=${id}`).join('&')
}

const useDocumentBatchAction = (
  action: DocumentActionType,
  options: { onError?: (error: Error) => void } = {},
) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return patch<CommonResponse>(
        `/datasets/${datasetId}/documents/status/${action}/batch?${toBatchDocumentsIdParams(documentId || documentIds!)}`,
      )
    },
  })
}

export const useDocumentEnable = (options: { onError?: (error: Error) => void } = {}) => {
  return useDocumentBatchAction(DocumentActionType.enable, options)
}

export const useDocumentDisable = (options: { onError?: (error: Error) => void } = {}) => {
  return useDocumentBatchAction(DocumentActionType.disable, options)
}

export const useDocumentArchive = (options: { onError?: (error: Error) => void } = {}) => {
  return useDocumentBatchAction(DocumentActionType.archive, options)
}

export const useDocumentUnArchive = (options: { onError?: (error: Error) => void } = {}) => {
  return useDocumentBatchAction(DocumentActionType.unArchive, options)
}

export const useDocumentDelete = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return del<CommonResponse>(
        `/datasets/${datasetId}/documents?${toBatchDocumentsIdParams(documentId || documentIds!)}`,
      )
    },
  })
}

export const useSyncDocument = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/notion/sync`)
    },
  })
}

export const useDocumentSummary = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return post<CommonResponse>(`/datasets/${datasetId}/documents/generate-summary`, {
        body: {
          document_list: documentId ? [documentId] : documentIds!,
        },
      })
    },
  })
}

export const useSyncWebsite = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/website-sync`)
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
      get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
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
      get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
  })
}

export const useInvalidDocumentDetail = () => {
  return useInvalid(useDocumentDetailKey)
}

export const useDocumentPause = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return pauseDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentResume = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return resumeDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentDownload = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId) throw new Error('datasetId and documentId are required')
      return fetchDocumentDownloadUrl({
        datasetId,
        documentId,
      }) as Promise<DocumentDownloadResponse>
    },
  })
}

export const useDocumentDownloadZip = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentIds }: DocumentDownloadZipRequest) => {
      if (!datasetId || !documentIds?.length)
        throw new Error('datasetId and documentIds are required')
      return downloadDocumentsZip({ datasetId, documentIds })
    },
  })
}

export const useDocumentBatchRetryIndex = (options: { onError?: (error: Error) => void } = {}) => {
  return useMutation({
    ...options,
    mutationFn: ({ datasetId, documentIds }: { datasetId: string; documentIds: string[] }) => {
      return post<CommonResponse>(`/datasets/${datasetId}/retry`, {
        body: {
          document_ids: documentIds,
        },
      })
    },
  })
}
