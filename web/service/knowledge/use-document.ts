import type { DocumentDownloadResponse, DocumentDownloadZipRequest, MetadataType, SortType } from '../datasets'
import type { CommonResponse } from '@/models/common'
import type { DocumentDetailResponse, DocumentListResponse, UpdateDocumentBatchParams } from '@/models/datasets'
import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { normalizeStatusForQuery } from '@/app/components/datasets/documents/status-filter'
import { DocumentActionType } from '@/models/datasets'
import { del, get, patch, post } from '../base'
import { downloadDocumentsZip, fetchDocumentDownloadUrl, pauseDocIndexing, resumeDocIndexing } from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'knowledge/document'

export const useDocumentListKey = [NAME_SPACE, 'documentList']
export const useDocumentList = (payload: {
  datasetId: string
  query: {
    keyword: string
    page: number
    limit: number
    sort?: SortType
    status?: string
  }
  refetchInterval?: number | false
}) => {
  const { query, datasetId, refetchInterval } = payload
  const { keyword, page, limit, sort, status } = query
  const normalizedStatus = normalizeStatusForQuery(status)
  const params: Record<string, number | string> = {
    keyword,
    page,
    limit,
  }
  if (sort)
    params.sort = sort
  if (normalizedStatus && normalizedStatus !== 'all')
    params.status = normalizedStatus
  return useQuery<DocumentListResponse>({
    queryKey: [...useDocumentListKey, datasetId, params],
    queryFn: () => get<DocumentListResponse>(`/datasets/${datasetId}/documents`, {
      params,
    }),
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
  return ids.map(id => `document_id=${id}`).join('&')
}

export const useDocumentBatchAction = (action: DocumentActionType) => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/status/${action}/batch?${toBatchDocumentsIdParams(documentId || documentIds!)}`)
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
      return del<CommonResponse>(`/datasets/${datasetId}/documents?${toBatchDocumentsIdParams(documentId || documentIds!)}`)
    },
  })
}

export const useSyncDocument = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/notion/sync`)
    },
  })
}

export const useDocumentSummary = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return post<CommonResponse>(`/datasets/${datasetId}/documents/generate-summary`, {
        body: {
          document_list: documentId ? [documentId] : documentIds!,
        },
      })
    },
  })
}

export const useSyncWebsite = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      return get<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/website-sync`)
    },
  })
}

const useDocumentDetailKey = [NAME_SPACE, 'documentDetail', 'withoutMetaData']
export const useDocumentDetail = (payload: {
  datasetId: string
  documentId: string
  params: { metadata: MetadataType }
}) => {
  const { datasetId, documentId, params } = payload
  return useQuery<DocumentDetailResponse>({
    queryKey: [...useDocumentDetailKey, 'withoutMetaData', datasetId, documentId, params],
    queryFn: () => get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
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
    queryFn: () => get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
  })
}

export const useInvalidDocumentDetail = () => {
  return useInvalid(useDocumentDetailKey)
}

export const useDocumentPause = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId)
        throw new Error('datasetId and documentId are required')
      return pauseDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentResume = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId)
        throw new Error('datasetId and documentId are required')
      return resumeDocIndexing({ datasetId, documentId }) as Promise<CommonResponse>
    },
  })
}

export const useDocumentDownload = () => {
  return useMutation({
    mutationFn: ({ datasetId, documentId }: UpdateDocumentBatchParams) => {
      if (!datasetId || !documentId)
        throw new Error('datasetId and documentId are required')
      return fetchDocumentDownloadUrl({ datasetId, documentId }) as Promise<DocumentDownloadResponse>
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
    mutationFn: ({ datasetId, documentIds }: { datasetId: string, documentIds: string[] }) => {
      return post<CommonResponse>(`/datasets/${datasetId}/retry`, {
        body: {
          document_ids: documentIds,
        },
      })
    },
  })
}
