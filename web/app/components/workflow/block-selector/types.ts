import type { ParametersSchema, PluginMeta, PluginTriggerSubscriptionConstructor, SupportedCreationMethods, TriggerEvent } from '../../plugins/types'
import type { Collection, Event } from '../../tools/types'
import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'

export enum TabsEnum {
  Start = 'start',
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

type PluginCommonDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
}

export type TriggerDefaultValue = PluginCommonDefaultValue & {
  plugin_id?: string
  event_name: string
  event_label: string
  event_description: string
  title: string
  plugin_unique_identifier: string
  is_team_authorization: boolean
  params: Record<string, unknown>
  paramSchemas: Record<string, unknown>[]
  output_schema: Record<string, unknown>
  subscription_id?: string
  meta?: PluginMeta
}

export type ToolDefaultValue = PluginCommonDefaultValue & {
  tool_name: string
  tool_label: string
  tool_description: string
  title: string
  is_team_authorization: boolean
  params: Record<string, unknown>
  paramSchemas: Record<string, unknown>[]
  output_schema?: Record<string, unknown>
  credential_id?: string
  meta?: PluginMeta
  plugin_id?: string
  provider_icon?: Collection['icon']
  provider_icon_dark?: Collection['icon']
  plugin_unique_identifier?: string
}

export type DataSourceDefaultValue = Omit<PluginCommonDefaultValue, 'provider_id'> & {
  plugin_id: string
  provider_type: string
  provider_name: string
  datasource_name: string
  datasource_label: string
  title: string
  fileExtensions?: string[]
  plugin_unique_identifier?: string
}

export type PluginDefaultValue = ToolDefaultValue | DataSourceDefaultValue | TriggerDefaultValue

export type ToolValue = {
  provider_name: string
  provider_show_name?: string
  tool_name: string
  tool_label: string
  tool_description?: string
  settings?: Record<string, unknown>
  parameters?: Record<string, unknown>
  enabled?: boolean
  extra?: { description?: string } & Record<string, unknown>
  credential_id?: string
}

export type DataSourceItem = {
  plugin_id: string
  plugin_unique_identifier: string
  provider: string
  declaration: {
    credentials_schema: unknown[]
    provider_type: string
    identity: {
      author: string
      description: TypeWithI18N
      icon: string | { background: string, content: string }
      label: TypeWithI18N
      name: string
      tags: string[]
    }
    datasources: {
      description: TypeWithI18N
      identity: {
        author: string
        icon?: string | { background: string, content: string }
        label: TypeWithI18N
        name: string
        provider: string
      }
      parameters: unknown[]
      output_schema?: {
        type: string
        properties: Record<string, unknown>
      }
    }[]
  }
  is_authorized: boolean
}

// Backend API types - exact match with Python definitions
export type TriggerParameter = {
  multiple: boolean
  name: string
  label: TypeWithI18N
  description?: TypeWithI18N
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'files'
    | 'model-selector' | 'app-selector' | 'object' | 'array' | 'dynamic-select'
  auto_generate?: {
    type: string
    value?: unknown
  } | null
  template?: {
    type: string
    value?: unknown
  } | null
  scope?: string | null
  required?: boolean
  default?: unknown
  min?: number | null
  max?: number | null
  precision?: number | null
  options?: Array<{
    value: string
    label: TypeWithI18N
    icon?: string | null
  }> | null
}

export type TriggerCredentialField = {
  type: 'secret-input' | 'text-input' | 'select' | 'boolean'
    | 'app-selector' | 'model-selector' | 'tools-selector'
  name: string
  scope?: string | null
  required: boolean
  default?: string | number | boolean | Array<unknown> | null
  options?: Array<{
    value: string
    label: TypeWithI18N
  }> | null
  label: TypeWithI18N
  help?: TypeWithI18N
  url?: string | null
  placeholder?: TypeWithI18N
}

export type TriggerSubscriptionSchema = {
  parameters_schema: TriggerParameter[]
  properties_schema: TriggerCredentialField[]
}

export type TriggerIdentity = {
  author: string
  name: string
  label: TypeWithI18N
  provider: string
}

export type TriggerDescription = {
  human: TypeWithI18N
  llm: TypeWithI18N
}

export type TriggerApiEntity = {
  name: string
  identity: TriggerIdentity
  description: TypeWithI18N
  parameters: TriggerParameter[]
  output_schema?: Record<string, unknown>
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
  plugin_unique_identifier: string
  supported_creation_methods: SupportedCreationMethods[]
  credentials_schema?: TriggerCredentialField[]
  subscription_constructor?: PluginTriggerSubscriptionConstructor | null
  subscription_schema: ParametersSchema[]
  events: TriggerEvent[]
}

// Frontend types - compatible with ToolWithProvider
export type TriggerWithProvider = Collection & {
  events: Event[]
  meta: PluginMeta
  plugin_unique_identifier: string
  credentials_schema?: TriggerCredentialField[]
  subscription_constructor?: PluginTriggerSubscriptionConstructor | null
  subscription_schema?: ParametersSchema[]
  supported_creation_methods: SupportedCreationMethods[]
}

// ===== API Service Types =====

// Trigger subscription instance types

export enum TriggerCredentialTypeEnum {
  ApiKey = 'api-key',
  Oauth2 = 'oauth2',
  Unauthorized = 'unauthorized',
}

type TriggerSubscriptionStructure = {
  id: string
  name: string
  provider: string
  credential_type: TriggerCredentialTypeEnum
  credentials: Record<string, unknown>
  endpoint: string
  parameters: Record<string, unknown>
  properties: Record<string, unknown>
  workflows_in_use: number
}

export type TriggerSubscription = TriggerSubscriptionStructure

export type TriggerSubscriptionBuilder = TriggerSubscriptionStructure

// OAuth configuration types
export type TriggerOAuthConfig = {
  configured: boolean
  custom_configured: boolean
  custom_enabled: boolean
  redirect_uri: string
  oauth_client_schema: ParametersSchema[]
  params: {
    client_id: string
    client_secret: string
    [key: string]: string
  }
  system_configured: boolean
}

export type TriggerOAuthClientParams = {
  client_id: string
  client_secret: string
  authorization_url?: string
  token_url?: string
  scope?: string
}

export type TriggerOAuthResponse = {
  authorization_url: string
  subscription_builder: TriggerSubscriptionBuilder
}

export type TriggerLogEntity = {
  id: string
  endpoint: string
  request: LogRequest
  response: LogResponse
  created_at: string
}

export type LogRequest = {
  method: string
  url: string
  headers: LogRequestHeaders
  data: string
}

export type LogRequestHeaders = {
  'Host': string
  'User-Agent': string
  'Content-Length': string
  'Accept': string
  'Content-Type': string
  'X-Forwarded-For': string
  'X-Forwarded-Host': string
  'X-Forwarded-Proto': string
  'X-Github-Delivery': string
  'X-Github-Event': string
  'X-Github-Hook-Id': string
  'X-Github-Hook-Installation-Target-Id': string
  'X-Github-Hook-Installation-Target-Type': string
  'Accept-Encoding': string
  [key: string]: string
}

export type LogResponse = {
  status_code: number
  headers: LogResponseHeaders
  data: string
}

export type LogResponseHeaders = {
  'Content-Type': string
  'Content-Length': string
  [key: string]: string
}
