import type { CommonNodeType } from '@/app/components/workflow/types'
import type { CollectionType, ToolParameter } from '@/app/components/tools/types'

export type PluginTriggerNodeType = CommonNodeType & {
  provider_id?: string
  provider_type?: CollectionType
  provider_name?: string
  tool_name?: string
  tool_label?: string
  tool_description?: string
  is_team_authorization?: boolean
  output_schema?: Record<string, any>
  paramSchemas?: ToolParameter[]
  config?: Record<string, any>
  meta?: any
}
