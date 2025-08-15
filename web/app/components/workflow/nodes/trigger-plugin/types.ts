import type { CommonNodeType } from '@/app/components/workflow/types'

export type PluginTriggerNodeType = CommonNodeType & {
  plugin_id?: string
  plugin_name?: string
  event_type?: string
  config?: Record<string, any>
}
