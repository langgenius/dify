import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import qs from 'qs'
import { get } from './base'
import type {
  DataSetListResponse,
  ErrorDocsResponse,
  ExternalAPIListResponse,
  HitTestingRecordsResponse,
  ProcessRuleResponse,
} from '@/models/datasets'
import type { ApiKeysListResponse } from '@/models/app'
import type { FetchDatasetsParams } from '@/models/datasets'

const NAME_SPACE = 'datasets'

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

export const useInfiniteDatasets = (
  params: Partial<FetchDatasetsParams['params']>,
  options?: {
    enabled?: boolean
  },
) => {
  const normalizedParams = normalizeDatasetsParams(params)
  const buildUrl = (pageParam: number | undefined) => {
    const queryString = qs.stringify({
      ...normalizedParams,
      page: pageParam ?? normalizedParams.page,
    }, { indices: false })
    return `/datasets?${queryString}`
  }

  return useInfiniteQuery<DataSetListResponse>({
    queryKey: [NAME_SPACE, 'list', normalizedParams],
    queryFn: ({ pageParam = normalizedParams.page }) => get<DataSetListResponse>(buildUrl(pageParam as number | undefined)),
    getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
    initialPageParam: normalizedParams.page,
    ...options,
  })
}

export const useDatasetApiKeys = (options?: { enabled?: boolean }) => {
  return useQuery<ApiKeysListResponse>({
    queryKey: [NAME_SPACE, 'api-keys'],
    queryFn: () => get<ApiKeysListResponse>('/datasets/api-keys'),
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
    queryFn: () => get<ExternalAPIListResponse>('/datasets/external-knowledge-api'),
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

export const useProcessRule = (documentId?: string) => {
  return useQuery<ProcessRuleResponse>({
    queryKey: [NAME_SPACE, 'process-rule', documentId],
    queryFn: () => get<ProcessRuleResponse>('/datasets/process-rule', { params: { document_id: documentId } }),
    enabled: !!documentId,
    refetchOnWindowFocus: false,
  })
}

export const useDatasetTestingRecords = (
  datasetId?: string,
  params?: { page: number; limit: number },
) => {
  return useQuery<HitTestingRecordsResponse>({
    queryKey: [NAME_SPACE, 'testing-records', datasetId, params],
    queryFn: () => get<HitTestingRecordsResponse>(`/datasets/${datasetId}/queries`, { params }),
    enabled: !!datasetId && !!params,
    placeholderData: keepPreviousData,
  })
}

export const useDatasetErrorDocs = (datasetId?: string) => {
  return useQuery<ErrorDocsResponse>({
    queryKey: [NAME_SPACE, 'error-docs', datasetId],
    queryFn: () => get<ErrorDocsResponse>(`/datasets/${datasetId}/error-docs`),
    enabled: !!datasetId,
  })
}
