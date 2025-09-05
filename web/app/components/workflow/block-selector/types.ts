import type { PluginMeta } from '../../plugins/types'
import type { Collection, Tool } from '../../tools/types'
import type { TypeWithI18N } from '../../base/form/types'

export enum TabsEnum {
  Start = 'start',
  Blocks = 'blocks',
  Tools = 'tools',
}

export enum ToolTypeEnum {
  All = 'all',
  BuiltIn = 'built-in',
  Custom = 'custom',
  Workflow = 'workflow',
  MCP = 'mcp',
}

export enum BlockClassificationEnum {
  Default = '-',
  QuestionUnderstand = 'question-understand',
  Logic = 'logic',
  Transform = 'transform',
  Utilities = 'utilities',
}

export type ToolDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
  tool_name: string
  tool_label: string
  tool_description: string
  title: string
  is_team_authorization: boolean
  params: Record<string, any>
  paramSchemas: Record<string, any>[]
  output_schema: Record<string, any>
  credential_id?: string
  meta?: PluginMeta
}

export type ToolValue = {
  provider_name: string
  provider_show_name?: string
  tool_name: string
  tool_label: string
  tool_description?: string
  settings?: Record<string, any>
  parameters?: Record<string, any>
  enabled?: boolean
  extra?: Record<string, any>
  credential_id?: string
}

// Backend API types - exact match with Python definitions
export type TriggerParameter = {
  name: string
  label: TypeWithI18N
  description?: TypeWithI18N
  type: string
  required?: boolean
  default?: any
}

export type TriggerIdentity = {
  author: string
  name: string
  version: string
}

export type TriggerDescription = {
  human: TypeWithI18N
  llm: TypeWithI18N
}

export type TriggerApiEntity = {
  name: string
  identity: TriggerIdentity
  description: TriggerDescription
  parameters: TriggerParameter[]
  output_schema?: Record<string, any>
}

export type TriggerProviderApiEntity = {
  author: string
  name: string
  label: TypeWithI18N
  description: TypeWithI18N
  icon?: string
  icon_dark?: string
  tags: string[]
  plugin_id?: string
  plugin_unique_identifier?: string
  triggers: TriggerApiEntity[]
}

// Frontend types - compatible with ToolWithProvider
export type TriggerWithProvider = Collection & {
  tools: Tool[] // Use existing Tool type for compatibility
  meta: PluginMeta
}
