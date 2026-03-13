import type {
  ExternalKnowledgeBaseHitTestingRequest,
  ExternalKnowledgeBaseHitTestingResponse,
  HitTestingRecordsRequest,
  HitTestingRecordsResponse,
  HitTestingRequest,
  HitTestingResponse,
} from '@/models/datasets'
import { useMutation, useQuery } from '@tanstack/react-query'
import { get, post } from '../base'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'hit-testing'

const HitTestingRecordsKey = [NAME_SPACE, 'records']

export const useHitTestingRecords = (params: HitTestingRecordsRequest) => {
  const { datasetId, page, limit } = params
  return useQuery({
    queryKey: [...HitTestingRecordsKey, datasetId, page, limit],
    queryFn: () => get<HitTestingRecordsResponse>(`/datasets/${datasetId}/queries`, { params: { page, limit } }),
  })
}

export const useInvalidateHitTestingRecords = (datasetId: string) => {
  return useInvalid([...HitTestingRecordsKey, datasetId])
}

export const useHitTesting = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'hit-testing', datasetId],
    mutationFn: (params: HitTestingRequest) => post<HitTestingResponse>(`/datasets/${datasetId}/hit-testing`, {
      body: params,
    }),
  })
}

export const useExternalKnowledgeBaseHitTesting = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'external-knowledge-base-hit-testing', datasetId],
    mutationFn: (params: ExternalKnowledgeBaseHitTestingRequest) => post<ExternalKnowledgeBaseHitTestingResponse>(`/datasets/${datasetId}/external-hit-testing`, {
      body: params,
    }),
  })
}
