import type { IndexingStatusResponse } from '@/models/datasets'
import { useEffect, useRef, useState } from 'react'
import { fetchIndexingStatusBatch } from '@/service/datasets'

const POLLING_INTERVAL = 2500
const COMPLETED_STATUSES = ['completed', 'error', 'paused'] as const
const EMBEDDING_STATUSES = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'] as const

type IndexingStatusPollingParams = {
  datasetId: string
  batchId: string
}

type IndexingStatusPollingResult = {
  statusList: IndexingStatusResponse[]
  isEmbedding: boolean
  isEmbeddingCompleted: boolean
}

const isStatusCompleted = (status: string): boolean =>
  COMPLETED_STATUSES.includes(status as typeof COMPLETED_STATUSES[number])

const isAllCompleted = (statusList: IndexingStatusResponse[]): boolean =>
  statusList.every(item => isStatusCompleted(item.indexing_status))

/**
 * Custom hook for polling indexing status with automatic stop on completion.
 * Handles the polling lifecycle and provides derived states for UI rendering.
 */
export const useIndexingStatusPolling = ({
  datasetId,
  batchId,
}: IndexingStatusPollingParams): IndexingStatusPollingResult => {
  const [statusList, setStatusList] = useState<IndexingStatusResponse[]>([])
  const isStopPollingRef = useRef(false)

  useEffect(() => {
    // Reset polling state on mount
    isStopPollingRef.current = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const fetchStatus = async (): Promise<IndexingStatusResponse[]> => {
      const response = await fetchIndexingStatusBatch({ datasetId, batchId })
      setStatusList(response.data)
      return response.data
    }

    const poll = async (): Promise<void> => {
      if (isStopPollingRef.current)
        return

      try {
        const data = await fetchStatus()
        if (isAllCompleted(data)) {
          isStopPollingRef.current = true
          return
        }
      }
      catch {
        // Continue polling on error
      }

      if (!isStopPollingRef.current) {
        timeoutId = setTimeout(() => {
          poll()
        }, POLLING_INTERVAL)
      }
    }

    poll()

    return () => {
      isStopPollingRef.current = true
      if (timeoutId)
        clearTimeout(timeoutId)
    }
  }, [datasetId, batchId])

  const isEmbedding = statusList.some(item =>
    EMBEDDING_STATUSES.includes(item?.indexing_status as typeof EMBEDDING_STATUSES[number]),
  )

  const isEmbeddingCompleted = statusList.length > 0 && isAllCompleted(statusList)

  return {
    statusList,
    isEmbedding,
    isEmbeddingCompleted,
  }
}
