import type { TriggerWithProvider } from '@/app/components/workflow/block-selector/types'
import type { PluginTriggerNodeType } from '@/app/components/workflow/nodes/trigger-plugin/types'

export type TriggerCheckParams = {
  triggerInputsSchema: Array<{
    variable: string
    label: string
    required?: boolean
  }>
  isReadyForCheckValid: boolean
}

export const getTriggerCheckParams = (
  triggerData: PluginTriggerNodeType,
  triggerProviders: TriggerWithProvider[] | undefined,
  language: string,
): TriggerCheckParams => {
  if (!triggerProviders) {
    return {
      triggerInputsSchema: [],
      isReadyForCheckValid: false,
    }
  }

  const {
    provider_id,
    provider_name,
    event_name,
  } = triggerData

  const provider = triggerProviders.find(item =>
    item.name === provider_name
    || item.id === provider_id
    || (provider_id && item.plugin_id === provider_id),
  )

  const currentEvent = provider?.events.find(event => event.name === event_name)

  const triggerInputsSchema = (currentEvent?.parameters || []).map((parameter) => {
    const label = parameter.label?.[language] || parameter.label?.en_US || parameter.name
    return {
      variable: parameter.name,
      label,
      required: parameter.required,
    }
  })

  return {
    triggerInputsSchema,
    isReadyForCheckValid: true,
  }
}
