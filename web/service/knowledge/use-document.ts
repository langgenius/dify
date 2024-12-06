import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { del, get, patch } from '../base'
import type { SimpleDocumentDetail, UpdateDocumentBatchParams } from '@/models/datasets'
import { BatchActionType } from '@/models/datasets'
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

const toBatchDocumentsIdParams = (documentIds: string[] | string) => {
  const ids = Array.isArray(documentIds) ? documentIds : [documentIds]
  return ids.map(id => `document_id=${id}`).join('=')
}

export const useDocumentBatchAction = (action: BatchActionType) => {
  return useMutation({
    mutationFn: ({ datasetId, documentIds, documentId }: UpdateDocumentBatchParams) => {
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/status/${action}?${toBatchDocumentsIdParams(documentId || documentIds!)}`)
    },
  })
}

export const useDocumentEnable = () => {
  return useDocumentBatchAction(BatchActionType.enable)
}

export const useDocumentDisable = () => {
  return useDocumentBatchAction(BatchActionType.disable)
}

export const useDocumentArchive = () => {
  return useDocumentBatchAction(BatchActionType.archive)
}

export const useDocumentUnArchive = () => {
  return useDocumentBatchAction(BatchActionType.unArchive)
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
