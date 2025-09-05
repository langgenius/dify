import { useQuery } from '@tanstack/react-query'
import { get } from './base'
import type { TriggerProviderApiEntity, TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import { CollectionType } from '@/app/components/tools/types'

const NAME_SPACE = 'triggers'

// Convert backend API response to frontend ToolWithProvider format
const convertToTriggerWithProvider = (provider: TriggerProviderApiEntity): TriggerWithProvider => {
  return {
    // Collection fields
    id: provider.plugin_id || provider.name,
    name: provider.name,
    author: provider.author,
    description: provider.description, // Already TypeWithI18N format
    icon: provider.icon || '',
    label: provider.label, // Already TypeWithI18N format
    type: CollectionType.builtIn,
    team_credentials: {},
    is_team_authorization: false,
    allow_delete: false,
    labels: provider.tags || [],
    plugin_id: provider.plugin_id,

    // ToolWithProvider fields - convert "triggers" to "tools"
    tools: provider.triggers.map(trigger => ({
      name: trigger.name,
      author: provider.author,
      label: trigger.description.human, // Already TypeWithI18N format
      description: trigger.description.llm, // Already TypeWithI18N format
      parameters: trigger.parameters.map(param => ({
        name: param.name,
        label: param.label, // Already TypeWithI18N format
        human_description: param.description || param.label,
        type: param.type,
        form: param.type,
        llm_description: JSON.stringify(param.description || {}),
        required: param.required || false,
        default: param.default || '',
        options: [],
      })),
      labels: provider.tags || [],
      output_schema: trigger.output_schema || {},
    })),

    meta: {
      version: '1.0',
    },
  }
}

// Main hook - follows exact same pattern as tools
export const useAllTriggerPlugins = (enabled = true) => {
  return useQuery<TriggerWithProvider[]>({
    queryKey: [NAME_SPACE, 'all'],
    queryFn: async () => {
      const response = await get<TriggerProviderApiEntity[]>('/workspaces/current/triggers')
      return response.map(convertToTriggerWithProvider)
    },
    enabled,
  })
}

// Additional hook for consistency with tools pattern
export const useTriggerPluginsByType = (triggerType: string, enabled = true) => {
  return useQuery<TriggerWithProvider[]>({
    queryKey: [NAME_SPACE, 'byType', triggerType],
    queryFn: async () => {
      const response = await get<TriggerProviderApiEntity[]>(`/workspaces/current/triggers?type=${triggerType}`)
      return response.map(convertToTriggerWithProvider)
    },
    enabled: enabled && !!triggerType,
  })
}
