import { get } from './base'
import type {
  FetchWorkflowDraftResponse,
} from '@/types/workflow'
import { useQuery } from '@tanstack/react-query'

const NAME_SPACE = 'workflow'

export const useAppWorkflow = (appID: string) => {
  return useQuery<FetchWorkflowDraftResponse>({
    queryKey: [NAME_SPACE, 'publish', appID],
    queryFn: () => {
      if (appID === 'empty')
        return Promise.resolve({} as unknown as FetchWorkflowDraftResponse)
      return get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`)
    },
  })
}
