import { useMutation, useQuery } from '@tanstack/react-query'
import { del, get, patch, post } from '../base'
import type { CommonResponse } from '@/models/common'
import type {
  BatchImportResponse,
  ChildChunkDetail,
  ChildSegmentsResponse,
  ChunkingMode,
  SegmentDetailModel,
  SegmentUpdater,
  SegmentsResponse,
} from '@/models/datasets'

const NAME_SPACE = 'segment'

export const useSegmentListKey = [NAME_SPACE, 'chunkList']

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
  })
}

export const useUpdateSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentId: string; body: SegmentUpdater }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return patch<{ data: SegmentDetailModel; doc_form: ChunkingMode }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}`, { body })
    },
  })
}

export const useAddSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'add'],
    mutationFn: (payload: { datasetId: string; documentId: string; body: SegmentUpdater }) => {
      const { datasetId, documentId, body } = payload
      return post<{ data: SegmentDetailModel; doc_form: ChunkingMode }>(`/datasets/${datasetId}/documents/${documentId}/segment`, { body })
    },
  })
}

export const useEnableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segment/enable?${query}`)
    },
  })
}

export const useDisableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      const query = segmentIds.map(id => `segment_id=${id}`).join('&')
      return patch<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segment/disable?${query}`)
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

export const useChildSegmentListKey = [NAME_SPACE, 'childChunkList']

export const useChildSegmentList = (
  payload: {
    datasetId: string
    documentId: string
    segmentId: string
    params: {
      page: number
      limit: number
      keyword: string
    }
  },
  disable?: boolean,
) => {
  const { datasetId, documentId, segmentId, params } = payload
  const { page, limit, keyword } = params
  return useQuery({
    queryKey: [...useChildSegmentListKey, datasetId, documentId, segmentId, page, limit, keyword],
    queryFn: () => {
      return get<ChildSegmentsResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`, { params })
    },
    enabled: !disable,
  })
}

export const useDeleteChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'delete'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentId: string; childChunkId: string }) => {
      const { datasetId, documentId, segmentId, childChunkId } = payload
      return del<CommonResponse>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`)
    },
  })
}

export const useAddChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'add'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentId: string; body: { content: string } }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return post<{ data: ChildChunkDetail }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks`, { body })
    },
  })
}

export const useUpdateChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'update'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentId: string; childChunkId: string; body: { content: string } }) => {
      const { datasetId, documentId, segmentId, childChunkId, body } = payload
      return patch<{ data: ChildChunkDetail }>(`/datasets/${datasetId}/documents/${documentId}/segments/${segmentId}/child_chunks/${childChunkId}`, { body })
    },
  })
}

export const useSegmentBatchImport = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport'],
    mutationFn: (payload: { url: string; body: FormData }) => {
      const { url, body } = payload
      return post<BatchImportResponse>(url, { body }, { bodyStringify: false, deleteContentType: true })
    },
  })
}

export const useCheckSegmentBatchImportProgress = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport', 'checkProgress'],
    mutationFn: (payload: { jobID: string }) => {
      const { jobID } = payload
      return get<BatchImportResponse>(`/datasets/batch_import_status/${jobID}`)
    },
  })
}
