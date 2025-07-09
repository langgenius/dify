import type { MutationOptions } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type {
  DataSet,
  DataSetListResponse,
  DatasetListRequest,
  IndexingStatusBatchRequest,
  IndexingStatusBatchResponse,
  ProcessRuleResponse,
  RelatedAppResponse,
} from '@/models/datasets'
import { get } from '../base'
import { useReset } from '../use-base'
import qs from 'qs'

const NAME_SPACE = 'dataset'

const DatasetListKey = [NAME_SPACE, 'list']

export const useDatasetList = (params: DatasetListRequest) => {
  const { initialPage, tag_ids, limit, include_all, keyword } = params
  return useInfiniteQuery({
    queryKey: [...DatasetListKey, initialPage, tag_ids, limit, include_all, keyword],
    queryFn: ({ pageParam = 1 }) => {
      const urlParams = qs.stringify({
        tag_ids,
        limit,
        include_all,
        keyword,
        page: pageParam,
      }, { indices: false })
      return get<DataSetListResponse>(`/datasets?${urlParams}`)
    },
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : null,
    initialPageParam: initialPage,
  })
}

export const useResetDatasetList = () => {
  return useReset([...DatasetListKey])
}

export const datasetDetailQueryKeyPrefix = [NAME_SPACE, 'detail']

export const useDatasetDetail = (datasetId: string) => {
  return useQuery({
    queryKey: [...datasetDetailQueryKeyPrefix, datasetId],
    queryFn: () => get<DataSet>(`/datasets/${datasetId}`),
    enabled: !!datasetId,
  })
}

export const useDatasetRelatedApps = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'related-apps', datasetId],
    queryFn: () => get<RelatedAppResponse>(`/datasets/${datasetId}/related-apps`),
  })
}

export const useIndexingStatusBatch = (
  params: IndexingStatusBatchRequest,
  mutationOptions: MutationOptions<IndexingStatusBatchResponse, Error> = {},
) => {
  const { datasetId, batchId } = params
  return useMutation({
    mutationKey: [NAME_SPACE, 'indexing-status-batch', datasetId, batchId],
    mutationFn: () => get<IndexingStatusBatchResponse>(`/datasets/${datasetId}/batch/${batchId}/indexing-status`),
    ...mutationOptions,
  })
}

export const useProcessRule = (documentId: string) => {
  return useQuery<ProcessRuleResponse>({
    queryKey: [NAME_SPACE, 'process-rule', documentId],
    queryFn: () => get<ProcessRuleResponse>('/datasets/process-rule', { params: { document_id: documentId } }),
  })
}
