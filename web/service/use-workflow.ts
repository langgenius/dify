import { get } from './base'
import type {
  FetchWorkflowDraftResponse,
} from '@/types/workflow'
import { useQuery } from '@tanstack/react-query'
import type { WorkflowConfigResponse } from '@/types/workflow'

const NAME_SPACE = 'workflow'

export const useAppWorkflow = (appID: string) => {
  return useQuery<FetchWorkflowDraftResponse>({
    enabled: !!appID,
    queryKey: [NAME_SPACE, 'publish', appID],
    queryFn: () => get<FetchWorkflowDraftResponse>(`/apps/${appID}/workflows/publish`),
  })
}

export const useWorkflowConfig = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'config', appId],
    queryFn: () => get<WorkflowConfigResponse>(`/apps/${appId}/workflows/draft/config`),
  })
}
