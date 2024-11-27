import {
  useQuery,
} from '@tanstack/react-query'
import { get } from '../base'
import type { SimpleDocumentDetail } from '@/models/datasets'

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
