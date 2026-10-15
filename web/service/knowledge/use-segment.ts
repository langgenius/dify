import type {
  BatchImportResponse,
  ChildChunkDetail,
  ChildSegmentsResponse,
  ChunkingMode,
  SegmentDetailModel,
  SegmentsResponse,
  SegmentUpdater,
} from '@/models/datasets'
import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient } from '../console'
import { narrowResponse } from '../console/narrow-response'

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
      return narrowResponse(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.get({
          params: { dataset_id: datasetId, document_id: documentId },
          query: { ...params, enabled: String(params.enabled) },
        }),
      )
    },
    enabled: !disable,
  })
}

export const useUpdateSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'update'],
    mutationFn: (payload: {
      datasetId: string
      documentId: string
      segmentId: string
      body: SegmentUpdater
    }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return narrowResponse<{ data: SegmentDetailModel; doc_form: ChunkingMode }>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.patch({
          params: { dataset_id: datasetId, document_id: documentId, segment_id: segmentId },
          body,
        }),
      )
    },
  })
}

export const useAddSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'add'],
    mutationFn: (payload: { datasetId: string; documentId: string; body: SegmentUpdater }) => {
      const { datasetId, documentId, body } = payload
      return narrowResponse<{ data: SegmentDetailModel; doc_form: ChunkingMode }>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segment.post({
          params: { dataset_id: datasetId, document_id: documentId },
          body,
        }),
      )
    },
  })
}

export const useEnableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.segment.byAction.patch({
        params: { dataset_id: datasetId, document_id: documentId, action: 'enable' },
        query: { segment_id: segmentIds },
      })
    },
  })
}

export const useDisableSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.segment.byAction.patch({
        params: { dataset_id: datasetId, document_id: documentId, action: 'disable' },
        query: { segment_id: segmentIds },
      })
    },
  })
}

export const useDeleteSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'delete'],
    mutationFn: (payload: { datasetId: string; documentId: string; segmentIds: string[] }) => {
      const { datasetId, documentId, segmentIds } = payload
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.delete({
        params: { dataset_id: datasetId, document_id: documentId },
        query: { segment_id: segmentIds },
      })
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
      return narrowResponse<ChildSegmentsResponse>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.get(
          {
            params: { dataset_id: datasetId, document_id: documentId, segment_id: segmentId },
            query: params,
          },
        ),
      )
    },
    enabled: !disable,
  })
}

export const useDeleteChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'delete'],
    mutationFn: (payload: {
      datasetId: string
      documentId: string
      segmentId: string
      childChunkId: string
    }) => {
      const { datasetId, documentId, segmentId, childChunkId } = payload
      return consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.byChildChunkId.delete(
        {
          params: {
            dataset_id: datasetId,
            document_id: documentId,
            segment_id: segmentId,
            child_chunk_id: childChunkId,
          },
        },
      )
    },
  })
}

export const useAddChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'add'],
    mutationFn: (payload: {
      datasetId: string
      documentId: string
      segmentId: string
      body: { content: string }
    }) => {
      const { datasetId, documentId, segmentId, body } = payload
      return narrowResponse<{ data: ChildChunkDetail }>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.post(
          {
            params: { dataset_id: datasetId, document_id: documentId, segment_id: segmentId },
            body,
          },
        ),
      )
    },
  })
}

export const useUpdateChildSegment = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'childChunk', 'update'],
    mutationFn: (payload: {
      datasetId: string
      documentId: string
      segmentId: string
      childChunkId: string
      body: { content: string }
    }) => {
      const { datasetId, documentId, segmentId, childChunkId, body } = payload
      return narrowResponse<{ data: ChildChunkDetail }>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.bySegmentId.childChunks.byChildChunkId.patch(
          {
            params: {
              dataset_id: datasetId,
              document_id: documentId,
              segment_id: segmentId,
              child_chunk_id: childChunkId,
            },
            body,
          },
        ),
      )
    },
  })
}

export const useSegmentBatchImport = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport'],
    mutationFn: (payload: {
      datasetId: string
      documentId: string
      body: { upload_file_id: string }
    }) => {
      const { datasetId, documentId, body } = payload
      return narrowResponse<BatchImportResponse>(
        consoleClient.datasets.byDatasetId.documents.byDocumentId.segments.batchImport.post({
          params: { dataset_id: datasetId, document_id: documentId },
          body,
        }),
      )
    },
  })
}

export const useCheckSegmentBatchImportProgress = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'batchImport', 'checkProgress'],
    mutationFn: (payload: { jobID: string }) => {
      const { jobID } = payload
      return narrowResponse<BatchImportResponse>(
        consoleClient.datasets.batchImportStatus.byJobId.get({ params: { job_id: jobID } }),
      )
    },
  })
}
