import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch } from '../base'
import type { CommonResponse } from '@/models/common'
import type { SegmentsResponse } from '@/models/datasets'

const NAME_SPACE = 'segment'

const useSegmentListKey = [NAME_SPACE, 'list']

export const useSegmentList = (
  payload: {
    datasetId: string
    documentId: string
    params: {
      page: number
      limit: number
      keyword: string
      enabled: boolean | 'all'
    }
  },
  disable?: boolean,
) => {
  const { datasetId, documentId, params } = payload
  const { page, limit, keyword, enabled } = params
  return useQuery<SegmentsResponse>({
    queryKey: [...useSegmentListKey, datasetId, documentId, page, limit, keyword, enabled],
    queryFn: () => {
      return get<SegmentsResponse>(`/datasets/${datasetId}/documents/${documentId}/segments`, { params })
    },
    enabled: !disable,
    initialData: disable ? { data: [], has_more: false, total: 0, total_pages: 0, limit: 10 } : undefined,
  })
}

export const useEnableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/enable?${query}`)
    },
  })
}

export const useDisableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/disable?${query}`)
    },
  })
}

export const useDeleteSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments?${query}`)
    },
  })
}
