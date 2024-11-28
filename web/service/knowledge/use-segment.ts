import { useMutation } from '@tanstack/react-query'
import { del, patch } from '../base'
import type { CommonResponse } from '@/models/common'

const NAME_SPACE = 'segment'

export const useEnableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (payload: { datasetId: string; segmentIds: string[] }) => {
      const { datasetId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/segments/enable?${query}`)
    },
  })
}

export const useDisableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (payload: { datasetId: string; segmentIds: string[] }) => {
      const { datasetId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/segments/disable?${query}`)
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
