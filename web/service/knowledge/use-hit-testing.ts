import type {
  ExternalKnowledgeBaseHitTestingRequest,
  ExternalKnowledgeBaseHitTestingResponse,
  HitTestingRequest,
  HitTestingResponse,
} from '@/models/datasets'
import { useMutation } from '@tanstack/react-query'
import { post } from '../base'

const NAME_SPACE = 'hit-testing'

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
