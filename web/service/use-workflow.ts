import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import type { WorkflowConfigResponse } from '@/types/workflow'

const NAME_SPACE = 'workflow'

export const useWorkflowConfig = () => {
  return useQuery({
    queryKey: [NAME_SPACE, 'config'],
    queryFn: () => get<WorkflowConfigResponse>('/apps/workflow-config'),
  })
}
