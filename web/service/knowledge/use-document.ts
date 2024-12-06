import {
  useMutation,
  useQuery,
} from '@tanstack/react-query'
import { get, patch } from '../base'
import type { SimpleDocumentDetail, UpdateDocumentBatchParams } from '@/models/datasets'
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

const toBatchDocumentsIdParams = (documentIds: string[]) => {
  return documentIds.map(id => `document_id=${id}`).join('=')
}

export const useDocumentBatchAction = () => {
  return useMutation({
    mutationFn: ({ action, datasetId, documentIds }: UpdateDocumentBatchParams) => {
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/status/${action}?${toBatchDocumentsIdParams(documentIds)}`)
    },
  })
}
