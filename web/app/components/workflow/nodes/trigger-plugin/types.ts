import type { CommonNodeType } from '@/app/components/workflow/types'
import type { CollectionType } from '@/app/components/tools/types'

export type PluginTriggerNodeType = CommonNodeType & {
  plugin_id?: string
  tool_name?: string
  event_type?: string
  config?: Record<string, any>
  provider_id?: string
  provider_type?: CollectionType
  provider_name?: string
}
