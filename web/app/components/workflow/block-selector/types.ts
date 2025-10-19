import type { PluginMeta } from '../../plugins/types'

import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'

export enum TabsEnum {
  Blocks = 'blocks',
  Tools = 'tools',
  Sources = 'sources',
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
  credential_id?: string
  meta?: PluginMeta
  output_schema?: Record<string, any>
}

export type DataSourceDefaultValue = {
  plugin_id: string
  provider_type: string
  provider_name: string
  datasource_name: string
  datasource_label: string
  title: string
  fileExtensions?: string[]
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

export type DataSourceItem = {
  plugin_id: string
  plugin_unique_identifier: string
  provider: string
  declaration: {
    credentials_schema: any[]
    provider_type: string
    identity: {
      author: string
      description: TypeWithI18N
      icon: string | { background: string; content: string }
      label: TypeWithI18N
      name: string
      tags: string[]
    }
    datasources: {
      description: TypeWithI18N
      identity: {
        author: string
        icon?: string | { background: string; content: string }
        label: TypeWithI18N
        name: string
        provider: string
      }
      parameters: any[]
      output_schema?: {
        type: string
        properties: Record<string, any>
      }
    }[]
  }
  is_authorized: boolean
}
