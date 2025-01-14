import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import type { WorkflowConfigResponse } from '@/types/workflow'

const NAME_SPACE = 'workflow'

export const useWorkflowConfig = (appId: string) => {
  return useQuery({
    queryKey: [NAME_SPACE, 'config', appId],
    queryFn: () => get<WorkflowConfigResponse>(`/apps/${appId}/workflows/draft/config`),
  })
}
