import type { DocumentStatusResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

const POLLING_INTERVAL = 2500
const COMPLETED_STATUSES = ['completed', 'error', 'paused'] as const
const EMBEDDING_STATUSES = ['indexing', 'splitting', 'parsing', 'cleaning', 'waiting'] as const
const EMPTY_STATUS_LIST: DocumentStatusResponse[] = []

type IndexingStatusPollingParams = {
  datasetId: string
  batchId: string
}

type IndexingStatusPollingResult = {
  statusList: DocumentStatusResponse[]
  isEmbedding: boolean
  isEmbeddingCompleted: boolean
}

const isStatusCompleted = (status: string): boolean =>
  COMPLETED_STATUSES.includes(status as (typeof COMPLETED_STATUSES)[number])

const isAllCompleted = (statusList: DocumentStatusResponse[]): boolean =>
  statusList.every((item) => isStatusCompleted(item.indexing_status))

/**
 * Batch indexing status, polled until every document has finished. A failed request keeps
 * the last statuses and is tried again at the next interval.
 */
export const indexingStatusBatchQueryOptions = ({
  datasetId,
  batchId,
}: IndexingStatusPollingParams) =>
  consoleQuery.datasets.byDatasetId.batch.byBatch.indexingStatus.get.queryOptions({
    input: { params: { dataset_id: datasetId, batch: batchId } },
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const statusList = query.state.data?.data
      return statusList && isAllCompleted(statusList) ? false : POLLING_INTERVAL
    },
  })

/**
 * Polls indexing status with automatic stop on completion and provides derived states for
 * UI rendering.
 */
export const useIndexingStatusPolling = (
  params: IndexingStatusPollingParams,
): IndexingStatusPollingResult => {
  const { data: statusList = EMPTY_STATUS_LIST } = useQuery({
    ...indexingStatusBatchQueryOptions(params),
    select: (response) => response.data,
  })

  const isEmbedding = statusList.some((item) =>
    EMBEDDING_STATUSES.includes(item?.indexing_status as (typeof EMBEDDING_STATUSES)[number]),
  )

  const isEmbeddingCompleted = statusList.length > 0 && isAllCompleted(statusList)

  return {
    statusList,
    isEmbedding,
    isEmbeddingCompleted,
  }
}
