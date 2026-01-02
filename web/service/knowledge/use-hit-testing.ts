import type {
  ExternalKnowledgeBaseHitTestingRequest,
  HitTestingRecordsRequest,
  HitTestingRequest,
} from '@/models/datasets'
import { useMutation, useQuery } from '@tanstack/react-query'
import { externalKnowledgeBaseHitTesting, fetchTestingRecords, hitTesting } from '../datasets'
import { useInvalid } from '../use-base'

const NAME_SPACE = 'hit-testing'

const HitTestingRecordsKey = [NAME_SPACE, 'records']

export const useHitTestingRecords = (params: HitTestingRecordsRequest) => {
  const { datasetId, page, limit } = params
  return useQuery({
    queryKey: [...HitTestingRecordsKey, datasetId, page, limit],
    queryFn: () => fetchTestingRecords({ datasetId, params: { page, limit } }),
  })
}

export const useInvalidateHitTestingRecords = (datasetId: string) => {
  return useInvalid([...HitTestingRecordsKey, datasetId])
}

export const useHitTesting = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'hit-testing', datasetId],
    mutationFn: (params: HitTestingRequest) => hitTesting({ datasetId, queryText: params.query, retrieval_model: params.retrieval_model }),
  })
}

export const useExternalKnowledgeBaseHitTesting = (datasetId: string) => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'external-knowledge-base-hit-testing', datasetId],
    mutationFn: (params: ExternalKnowledgeBaseHitTestingRequest) => externalKnowledgeBaseHitTesting({ datasetId, query: params.query, external_retrieval_model: params.external_retrieval_model }),
  })
}
