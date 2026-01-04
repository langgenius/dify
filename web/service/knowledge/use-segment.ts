import type {
  SegmentsResponse,
  SegmentUpdater,
} from '@/models/datasets'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  addChildSegment,
  addSegment,
  batchImportSegments,
  checkSegmentBatchImportStatus,
  deleteChildSegment,
  deleteSegments,
  disableSegments,
  enableSegments,
  fetchChildSegments,
  fetchSegmentList,
  updateChildSegment,
  updateSegment,
} from '../datasets'

const NAME_SPACE = 'segment'

export const useSegmentListKey = [NAME_SPACE, 'chunkList']
export const useChunkListEnabledKey = [NAME_SPACE, 'chunkList', { enabled: true }]
export const useChunkListDisabledKey = [NAME_SPACE, 'chunkList', { enabled: false }]
export const useChunkListAllKey = [NAME_SPACE, 'chunkList', { enabled: 'all' }]

export const useSegmentList = (
  payload: {
    datasetId: string
    documentId: string
    params: {
      page: number
      limit: number
      keyword: string
      enabled: boolean | 'all' | ''
    }
  },
  disable?: boolean,
) => {
  const { datasetId, documentId, params } = payload

  return useQuery<SegmentsResponse>({
    queryKey: [...useSegmentListKey, datasetId, documentId, params],
    queryFn: () => {
      return fetchSegmentList(datasetId, documentId, params)
    },
    enabled: !disable,
  })
}

export const useUpdateSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentId: string, body: SegmentUpdater }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return updateSegment(datasetId, documentId, segmentId, body)
    },
  })
}

export const useAddSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'add'],
    mutationFn: (payload: { datasetId: string, documentId: string, body: SegmentUpdater }) => {
      const { datasetId, documentId, body } = payload
      return addSegment(datasetId, documentId, body)
    },
  })
}

export const useEnableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return enableSegments(datasetId, documentId, segmentIds)
    },
  })
}

export const useDisableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return disableSegments(datasetId, documentId, segmentIds)
    },
  })
}

export const useDeleteSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return deleteSegments(datasetId, documentId, segmentIds)
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

  return useQuery({
    queryKey: [...useChildSegmentListKey, datasetId, documentId, segmentId, params],
    queryFn: () => {
      return fetchChildSegments(datasetId, documentId, segmentId, params)
    },
    enabled: !disable,
  })
}

export const useDeleteChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'delete'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentId: string, childChunkId: string }) => {
      const { datasetId, documentId, segmentId, childChunkId } = payload
      return deleteChildSegment(datasetId, documentId, segmentId, childChunkId)
    },
  })
}

export const useAddChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'add'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentId: string, body: { content: string } }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return addChildSegment(datasetId, documentId, segmentId, body)
    },
  })
}

export const useUpdateChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'update'],
    mutationFn: (payload: { datasetId: string, documentId: string, segmentId: string, childChunkId: string, body: { content: string } }) => {
      const { datasetId, documentId, segmentId, childChunkId, body } = payload
      return updateChildSegment(datasetId, documentId, segmentId, childChunkId, body)
    },
  })
}

export const useSegmentBatchImport = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport'],
    mutationFn: (payload: { url: string, body: { upload_file_id: string } }) => {
      const { url, body } = payload
      return batchImportSegments(url, body)
    },
  })
}

export const useCheckSegmentBatchImportProgress = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport', 'checkProgress'],
    mutationFn: (payload: { jobID: string }) => {
      const { jobID } = payload
      return checkSegmentBatchImportStatus(jobID)
    },
  })
}
