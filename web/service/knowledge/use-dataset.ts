import type { InfiniteData, MutationOptions, QueryKey } from '@tanstack/react-query'
import type { ApiKeysListResponse } from '@/models/app'
import type {
  DatasetListRequest,
  DataSetListResponse,
  ErrorDocsResponse,
  ExternalAPIListResponse,
  FetchDatasetsParams,
  HitTestingRecordsResponse,
  IndexingStatusBatchRequest,
  IndexingStatusBatchResponse,
  ProcessRuleResponse,
} from '@/models/datasets'
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  disableDatasetServiceApi,
  enableDatasetServiceApi,
  fetchDatasetApiBaseInfo,
  fetchDatasetApiKeys,
  fetchDatasetDetail,
  fetchDatasetErrorDocs,
  fetchDatasetRelatedApps,
  fetchDatasets,
  fetchDatasetTestingRecords,
  fetchExternalKnowledgeApiList,
  fetchIndexingStatusBatch,
  fetchProcessRule,
} from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'dataset'

const DatasetListKey = [NAME_SPACE, 'list']

const normalizeDatasetsParams = (params: Partial<FetchDatasetsParams['params']> = {}) => {
  const {
    page = 1,
    limit,
    ids,
    tag_ids,
    include_all,
    keyword,
  } = params

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

  return useInfiniteQuery<DataSetListResponse, Error, InfiniteData<DataSetListResponse>, QueryKey, number>({
    queryKey: [...DatasetListKey, 'infinite', normalizedParams],
    queryFn: ({ pageParam = normalizedParams.page }) => fetchDatasets({
      url: '/datasets',
      params: {
        ...normalizedParams,
        page: pageParam ?? normalizedParams.page,
      },
    }),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: normalizedParams.page,
    staleTime: 0,
    refetchOnMount: 'always',
    ...options,
  })
}

export const useDatasetList = (params: DatasetListRequest) => {
  const { initialPage, tag_ids, limit, include_all, keyword } = params
  return useInfiniteQuery({
    queryKey: [...DatasetListKey, initialPage, tag_ids, limit, include_all, keyword],
    queryFn: ({ pageParam = 1 }) => {
      return fetchDatasets({
        url: '/datasets',
        params: {
          tag_ids,
          limit,
          include_all,
          keyword,
          page: pageParam,
        },
      })
    },
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : null,
    initialPageParam: initialPage,
  })
}

export const useInvalidDatasetList = () => {
  return useInvalid([...DatasetListKey])
}

export const datasetDetailQueryKeyPrefix = [NAME_SPACE, 'detail']

export const useDatasetDetail = (datasetId: string) => {
  return useQuery({
    queryKey: [...datasetDetailQueryKeyPrefix, datasetId],
    queryFn: () => fetchDatasetDetail(datasetId),
    enabled: !!datasetId,
  })
}

export const useDatasetRelatedApps = (datasetId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'related-apps', datasetId],
    queryFn: () => fetchDatasetRelatedApps(datasetId),
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
    queryFn: () => fetchProcessRule({ params: { documentId: documentId || '' } }),
    enabled: !!documentId,
    refetchOnWindowFocus: false,
  })
}

export const useDatasetApiBaseUrl = () => {
  return useQuery<{ api_base_url: string }>({
    queryKey: [NAME_SPACE, 'api-base-info'],
    queryFn: () => fetchDatasetApiBaseInfo(),
  })
}

export const useEnableDatasetServiceApi = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'enable-api'],
    mutationFn: (datasetId: string) => enableDatasetServiceApi(datasetId),
  })
}

export const useDisableDatasetServiceApi = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'disable-api'],
    mutationFn: (datasetId: string) => disableDatasetServiceApi(datasetId),
  })
}

export const useDatasetApiKeys = (options?: { enabled?: boolean }) => {
  return useQuery<ApiKeysListResponse>({
    queryKey: [NAME_SPACE, 'api-keys'],
    queryFn: () => fetchDatasetApiKeys(),
    enabled: options?.enabled ?? true,
  })
}

export const useInvalidateDatasetApiKeys = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'api-keys'],
    })
  }
}

export const useExternalKnowledgeApiList = (options?: { enabled?: boolean }) => {
  return useQuery<ExternalAPIListResponse>({
    queryKey: [NAME_SPACE, 'external-knowledge-api'],
    queryFn: () => fetchExternalKnowledgeApiList(),
    enabled: options?.enabled ?? true,
  })
}

export const useInvalidateExternalKnowledgeApiList = () => {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: [NAME_SPACE, 'external-knowledge-api'],
    })
  }
}

export const useDatasetTestingRecords = (
  datasetId?: string,
  params?: { page: number, limit: number },
) => {
  return useQuery<HitTestingRecordsResponse>({
    queryKey: [NAME_SPACE, 'testing-records', datasetId, params],
    queryFn: () => fetchDatasetTestingRecords(datasetId || '', params),
    enabled: !!datasetId && !!params,
    placeholderData: keepPreviousData,
  })
}

export const useDatasetErrorDocs = (datasetId?: string) => {
  return useQuery<ErrorDocsResponse>({
    queryKey: [NAME_SPACE, 'error-docs', datasetId],
    queryFn: () => fetchDatasetErrorDocs(datasetId || ''),
    enabled: !!datasetId,
  })
}
