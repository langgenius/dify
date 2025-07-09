import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { del, get, patch } from '../base'
import { useInvalid } from '../use-base'
import type { MetadataType, SortType } from '../datasets'
import { pauseDocIndexing, resumeDocIndexing } from '../datasets'
import type { DocumentDetailResponse, DocumentListResponse, UpdateDocumentBatchParams } from '@/models/datasets'
import { DocumentActionType } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'

const NAME_SPACE = 'knowledge/document'

export const useDocumentListKey = [NAME_SPACE, 'documentList']
export const useDocumentList = (payload: {
  datasetId: string
  query: {
    keyword: string
    page: number
    limit: number
    sort?: SortType
  },
  refetchInterval?: number | false
}) => {
  const { query, datasetId, refetchInterval } = payload
  const { keyword, page, limit, sort } = query
  return useQuery<DocumentListResponse>({
    queryKey: [...useDocumentListKey, datasetId, keyword, page, limit, sort],
    queryFn: () => get<DocumentListResponse>(`/datasets/${datasetId}/documents`, {
      params: query,
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
    queryKey: [...useDocumentDetailKey, 'withoutMetaData', datasetId, documentId],
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
    queryKey: [...useDocumentDetailKey, 'onlyMetaData', datasetId, documentId],
    queryFn: () => get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
  })
}

export const useInvalidDocumentDetailKey = () => {
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
