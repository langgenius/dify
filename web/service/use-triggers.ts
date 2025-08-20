import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import type { ToolWithProvider } from '@/app/components/workflow/types'

const NAME_SPACE = 'triggers'

// Get all plugins that support trigger functionality
// TODO: Backend API not implemented yet - replace with actual triggers endpoint
export const useAllTriggerPlugins = (enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: [NAME_SPACE, 'all'],
    queryFn: () => get<ToolWithProvider[]>('/workspaces/current/triggers/plugins'),
    enabled,
  })
}

// Get trigger-capable plugins by type (schedule, webhook, etc.)
// TODO: Backend API not implemented yet - replace with actual triggers endpoint
export const useTriggerPluginsByType = (triggerType: string, enabled = true) => {
  return useQuery<ToolWithProvider[]>({
    queryKey: [NAME_SPACE, 'byType', triggerType],
    queryFn: () => get<ToolWithProvider[]>(`/workspaces/current/triggers/plugins?type=${triggerType}`),
    enabled: enabled && !!triggerType,
  })
}
