import type { CommonResponse } from '@/models/common'
import type { IndexingStatusResponse } from '@/models/datasets'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  fetchIndexingStatus,
  pauseDocIndexing,
  resumeDocIndexing,
} from '@/service/datasets'

const NAME_SPACE = 'embedding'

export type EmbeddingStatusType = 'indexing' | 'splitting' | 'parsing' | 'cleaning' | 'completed' | 'paused' | 'error' | 'waiting' | ''

const EMBEDDING_STATUSES = ['indexing', 'splitting', 'parsing', 'cleaning'] as const
const TERMINAL_STATUSES = ['completed', 'error', 'paused'] as const

export const isEmbeddingStatus = (status?: string): boolean => {
  return EMBEDDING_STATUSES.includes(status as typeof EMBEDDING_STATUSES[number])
}

export const isTerminalStatus = (status?: string): boolean => {
  return TERMINAL_STATUSES.includes(status as typeof TERMINAL_STATUSES[number])
}

export const calculatePercent = (completed?: number, total?: number): number => {
  if (!total || total === 0)
    return 0
  const percent = Math.round((completed || 0) * 100 / total)
  return Math.min(percent, 100)
}

type UseEmbeddingStatusOptions = {
  datasetId?: string
  documentId?: string
  enabled?: boolean
  onComplete?: () => void
}

export const useEmbeddingStatus = ({
  datasetId,
  documentId,
  enabled = true,
  onComplete,
}: UseEmbeddingStatusOptions) => {
  const queryClient = useQueryClient()
  const isPolling = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const queryKey = useMemo(
    () => [NAME_SPACE, 'indexing-status', datasetId, documentId] as const,
    [datasetId, documentId],
  )

  const query = useQuery<IndexingStatusResponse>({
    queryKey,
    queryFn: () => fetchIndexingStatus({ datasetId: datasetId!, documentId: documentId! }),
    enabled: enabled && !!datasetId && !!documentId,
    refetchInterval: (query) => {
      const status = query.state.data?.indexing_status
      if (isTerminalStatus(status)) {
        return false
      }
      return 2500
    },
    refetchOnWindowFocus: false,
  })

  const status = query.data?.indexing_status || ''
  const isEmbedding = isEmbeddingStatus(status)
  const isCompleted = status === 'completed'
  const isPaused = status === 'paused'
  const isError = status === 'error'
  const percent = calculatePercent(query.data?.completed_segments, query.data?.total_segments)

  // Handle completion callback
  useEffect(() => {
    if (isTerminalStatus(status) && isPolling.current) {
      isPolling.current = false
      onCompleteRef.current?.()
    }
    if (isEmbedding) {
      isPolling.current = true
    }
  }, [status, isEmbedding])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const resetStatus = useCallback(() => {
    queryClient.setQueryData(queryKey, null)
  }, [queryClient, queryKey])

  return {
    data: query.data,
    isLoading: query.isLoading,
    isEmbedding,
    isCompleted,
    isPaused,
    isError,
    percent,
    invalidate,
    resetStatus,
    refetch: query.refetch,
  }
}

type UsePauseResumeOptions = {
  datasetId?: string
  documentId?: string
  onSuccess?: () => void
  onError?: (error: Error) => void
}

export const usePauseIndexing = ({ datasetId, documentId, onSuccess, onError }: UsePauseResumeOptions) => {
  return useMutation<CommonResponse, Error>({
    mutationKey: [NAME_SPACE, 'pause', datasetId, documentId],
    mutationFn: () => pauseDocIndexing({ datasetId: datasetId!, documentId: documentId! }),
    onSuccess,
    onError,
  })
}

export const useResumeIndexing = ({ datasetId, documentId, onSuccess, onError }: UsePauseResumeOptions) => {
  return useMutation<CommonResponse, Error>({
    mutationKey: [NAME_SPACE, 'resume', datasetId, documentId],
    mutationFn: () => resumeDocIndexing({ datasetId: datasetId!, documentId: documentId! }),
    onSuccess,
    onError,
  })
}

export const useInvalidateEmbeddingStatus = () => {
  const queryClient = useQueryClient()
  return useCallback((datasetId?: string, documentId?: string) => {
    if (datasetId && documentId) {
      queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'indexing-status', datasetId, documentId],
      })
    }
    else {
      queryClient.invalidateQueries({
        queryKey: [NAME_SPACE, 'indexing-status'],
      })
    }
  }, [queryClient])
}
