import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { del, get, patch } from '../base'
import { useInvalid } from '../use-base'
import type { MetadataType } from '../datasets'
import type { DocumentDetailResponse, SimpleDocumentDetail, UpdateDocumentBatchParams } from '@/models/datasets'
import { DocumentActionType } from '@/models/datasets'
import type { CommonResponse } from '@/models/common'

const NAME_SPACE = 'knowledge/document'

const useDocumentListKey = [NAME_SPACE, 'documentList']
export const useDocumentList = (payload: {
  datasetId: string
  query: {
    keyword: string
    page: number
    limit: number
  }
}) => {
  const { query, datasetId } = payload
  return useQuery<{ data: SimpleDocumentDetail[] }>({
    queryKey: [...useDocumentListKey, datasetId, query],
    queryFn: () => get<{ data: SimpleDocumentDetail[] }>(`/datasets/${datasetId}/documents`, {
      params: query,
    }),
  })
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

const useDocumentDetailKey = [NAME_SPACE, 'documentDetail']
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
    queryKey: [...useDocumentDetailKey, 'withMetaData', datasetId, documentId],
    queryFn: () => get<DocumentDetailResponse>(`/datasets/${datasetId}/documents/${documentId}`, { params }),
  })
}

export const useInvalidDocumentDetailKey = () => {
  return useInvalid(useDocumentDetailKey)
}
