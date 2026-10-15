import type { MutationOptions } from '@tanstack/react-query'
import type {
  DataSet,
  DatasetListRequest,
  DataSetListResponse,
  ErrorDocsResponse,
  FetchDatasetsParams,
  HitTestingRecordsResponse,
  IndexingStatusBatchRequest,
  IndexingStatusBatchResponse,
  ProcessRuleResponse,
  RelatedAppResponse,
} from '@/models/datasets'
import { ORPCError } from '@orpc/client'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { consoleClient } from '../console'
import { narrowResponse } from '../console/narrow-response'
import { fetchIndexingStatusBatch } from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'dataset'

const datasetListQueryKey = [NAME_SPACE, 'list']

const normalizeDatasetsParams = (params: Partial<FetchDatasetsParams['params']> = {}) => {
  const { page = 1, limit, ids, tag_ids, include_all, keyword } = params

  return {
    page,
    ...(limit ? { limit } : {}),
    ...(ids?.length ? { ids } : {}),
    ...(tag_ids?.length ? { tag_ids } : {}),
    ...(include_all !== undefined ? { include_all } : {}),
    ...(keyword ? { keyword } : {}),
  }
}

type UseInfiniteDatasetsOptions = {
  enabled?: boolean
  refetchOnMount?: boolean | 'always'
  staleTime?: number
  refetchOnReconnect?: boolean
  refetchOnWindowFocus?: boolean
}

export const useInfiniteDatasets = (
  params: Partial<FetchDatasetsParams['params']>,
  options?: UseInfiniteDatasetsOptions,
) => {
  const normalizedParams = normalizeDatasetsParams(params)

  return useInfiniteQuery<DataSetListResponse>({
    queryKey: [...datasetListQueryKey, 'infinite', normalizedParams],
    queryFn: ({ pageParam = normalizedParams.page }) =>
      narrowResponse(
        consoleClient.datasets.get({
          query: { ...normalizedParams, page: pageParam as number | undefined },
        }),
      ),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : undefined),
    initialPageParam: normalizedParams.page,
    staleTime: 0,
    refetchOnMount: 'always',
    ...options,
  })
}

export const useDatasetList = (params: DatasetListRequest) => {
  const { initialPage, tag_ids, limit, include_all, keyword } = params
  return useInfiniteQuery({
    queryKey: [...datasetListQueryKey, initialPage, tag_ids, limit, include_all, keyword],
    queryFn: ({ pageParam = 1 }) =>
      narrowResponse<DataSetListResponse>(
        consoleClient.datasets.get({
          query: { tag_ids, limit, include_all, keyword, page: pageParam },
        }),
      ),
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.page + 1 : null),
    initialPageParam: initialPage,
    placeholderData: keepPreviousData,
  })
}

export const useInvalidDatasetList = () => {
  return useInvalid([...datasetListQueryKey])
}

export const datasetDetailQueryKeyPrefix = [NAME_SPACE, 'detail']

export const useDatasetDetail = (datasetId: string) => {
  return useQuery({
    queryKey: [...datasetDetailQueryKeyPrefix, datasetId],
    queryFn: () =>
      narrowResponse<DataSet>(
        consoleClient.datasets.byDatasetId.get({ params: { dataset_id: datasetId } }),
      ),
    enabled: !!datasetId,
    retry: (failureCount, error) => {
      if (error instanceof ORPCError && [403, 404].includes(error.status)) return false

      return failureCount < 3
    },
  })
}

export const useDatasetRelatedApps = (datasetId: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'related-apps', datasetId],
    queryFn: () =>
      narrowResponse<RelatedAppResponse>(
        consoleClient.datasets.byDatasetId.relatedApps.get({ params: { dataset_id: datasetId } }),
      ),
    enabled: options?.enabled ?? !!datasetId,
  })
}

export const useIndexingStatusBatch = (
  params: IndexingStatusBatchRequest,
  mutationOptions: MutationOptions<IndexingStatusBatchResponse, Error> = {},
) => {
  const { datasetId, batchId } = params
  return useMutation({
    mutationKey: [NAME_SPACE, 'indexing-status-batch', datasetId, batchId],
    mutationFn: () => fetchIndexingStatusBatch({ datasetId, batchId }),
    ...mutationOptions,
  })
}

export const useProcessRule = (documentId?: string) => {
  return useQuery<ProcessRuleResponse>({
    queryKey: [NAME_SPACE, 'process-rule', documentId],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.processRule.get({ query: { document_id: documentId } }),
      ),
    enabled: !!documentId,
    refetchOnWindowFocus: false,
  })
}

export const useDatasetApiBaseUrl = () => {
  return useQuery<{ api_base_url: string }>({
    queryKey: [NAME_SPACE, 'api-base-info'],
    queryFn: () => consoleClient.datasets.apiBaseInfo.get(),
  })
}

export const useEnableDatasetServiceApi = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable-api'],
    mutationFn: (datasetId: string) =>
      consoleClient.datasets.byDatasetId.apiKeys.byStatus.post({
        params: { dataset_id: datasetId, status: 'enable' },
      }),
  })
}

export const useDisableDatasetServiceApi = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable-api'],
    mutationFn: (datasetId: string) =>
      consoleClient.datasets.byDatasetId.apiKeys.byStatus.post({
        params: { dataset_id: datasetId, status: 'disable' },
      }),
  })
}

export const useDatasetTestingRecords = (
  datasetId?: string,
  params?: { page: number; limit: number },
  options?: { enabled?: boolean },
) => {
  return useQuery<HitTestingRecordsResponse>({
    queryKey: [NAME_SPACE, 'testing-records', datasetId, params],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.byDatasetId.queries.get({
          params: { dataset_id: datasetId! },
          query: params,
        }),
      ),
    enabled: !!datasetId && !!params && (options?.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

export const useDatasetErrorDocs = (datasetId?: string) => {
  return useQuery<ErrorDocsResponse>({
    queryKey: [NAME_SPACE, 'error-docs', datasetId],
    queryFn: () =>
      narrowResponse(
        consoleClient.datasets.byDatasetId.errorDocs.get({ params: { dataset_id: datasetId! } }),
      ),
    enabled: !!datasetId,
  })
}
