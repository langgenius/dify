import type { PluginMeta } from '../../plugins/types'
import type { Collection, Trigger } from '../../tools/types'
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

export type PluginDefaultValue = {
  provider_id: string
  provider_type: string
  provider_name: string
}

export type TriggerDefaultValue = PluginDefaultValue & {
  trigger_name: string
  trigger_label: string
  trigger_description: string
  title: string
  is_team_authorization: boolean
  params: Record<string, any>
  paramSchemas: Record<string, any>[]
  output_schema: Record<string, any>
  credential_id?: string
  meta?: PluginMeta
}

export type ToolDefaultValue = PluginDefaultValue & {
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
  multiple: boolean
  name: string
  label: TypeWithI18N
  description?: TypeWithI18N
  type: 'string' | 'number' | 'boolean' | 'select' | 'file' | 'files'
  | 'model-selector' | 'app-selector' | 'object' | 'array' | 'dynamic-select'
  auto_generate?: {
    type: string
    value?: any
  } | null
  template?: {
    type: string
    value?: any
  } | null
  scope?: string | null
  required?: boolean
  default?: any
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
  default?: string | number | boolean | Array<any> | null
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
  credentials_schema: TriggerCredentialField[]
  oauth_client_schema: TriggerCredentialField[]
  subscription_schema: TriggerSubscriptionSchema
  triggers: TriggerApiEntity[]
}

// Frontend types - compatible with ToolWithProvider
export type TriggerWithProvider = Collection & {
  triggers: Trigger[]
  meta: PluginMeta
  credentials_schema?: TriggerCredentialField[]
  oauth_client_schema?: TriggerCredentialField[]
  subscription_schema?: TriggerSubscriptionSchema
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
  credentials: TriggerSubCredentials
  endpoint: string
  parameters: TriggerSubParameters
  properties: TriggerSubProperties
}

export type TriggerSubscription = TriggerSubscriptionStructure

export type TriggerSubCredentials = {
  access_tokens: string
}

export type TriggerSubParameters = {
  repository: string
  webhook_secret?: string
}

export type TriggerSubProperties = {
  active: boolean
  events: string[]
  external_id: string
  repository: string
  webhook_secret?: string
}

export type TriggerSubscriptionBuilder = TriggerSubscriptionStructure

// OAuth configuration types
export type TriggerOAuthConfig = {
  configured: boolean
  custom_configured: boolean
  custom_enabled: boolean
  params: {
    client_id: string
    client_secret: string
  }
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
