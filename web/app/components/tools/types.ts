import type { TypeWithI18N } from '../header/account-setting/model-provider-page/declarations'

export enum LOC {
  tools = 'tools',
  app = 'app',
}

export enum AuthType {
  none = 'none',
  apiKeyHeader = 'api_key_header',
  apiKeyQuery = 'api_key_query',
}

export enum AuthHeaderPrefix {
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
}

export type Credential = {
  auth_type: AuthType
  api_key_header?: string
  api_key_value?: string
  api_key_header_prefix?: AuthHeaderPrefix
  api_key_query_param?: string
}

export enum CollectionType {
  all = 'all',
  builtIn = 'builtin',
  custom = 'api',
  model = 'model',
  workflow = 'workflow',
  mcp = 'mcp',
}

export type Emoji = {
  background: string
  content: string
}

export type Collection = {
  id: string
  name: string
  author: string
  description: TypeWithI18N
  icon: string | Emoji
  label: TypeWithI18N
  type: CollectionType
  team_credentials: Record<string, any>
  is_team_authorization: boolean
  allow_delete: boolean
  labels: string[]
  plugin_id?: string
  letter?: string
  // MCP Server
  server_url?: string
  updated_at?: number
  server_identifier?: string
}

export type ToolParameter = {
  name: string
  label: TypeWithI18N
  human_description: TypeWithI18N
  type: string
  form: string
  llm_description: string
  required: boolean
  default: string
  options?: {
    label: TypeWithI18N
    value: string
  }[]
  min?: number
  max?: number
}

// Action
export type Tool = {
  name: string
  author: string
  label: TypeWithI18N
  description: any
  parameters: ToolParameter[]
  labels: string[]
  output_schema: Record<string, any>
}

export type ToolCredential = {
  name: string
  label: TypeWithI18N
  help: TypeWithI18N | null
  placeholder: TypeWithI18N
  type: string
  required: boolean
  default: string
  options?: {
    label: TypeWithI18N
    value: string
  }[]
}

export type CustomCollectionBackend = {
  provider: string
  original_provider?: string
  credentials: Credential
  icon: Emoji
  schema_type: string
  schema: string
  privacy_policy: string
  custom_disclaimer: string
  tools?: ParamItem[]
  id: string
  labels: string[]
}

export type ParamItem = {
  name: string
  label: TypeWithI18N
  human_description: TypeWithI18N
  llm_description: string
  type: string
  form: string
  required: boolean
  default: string
  min?: number
  max?: number
  options?: {
    label: TypeWithI18N
    value: string
  }[]
}

export type CustomParamSchema = {
  operation_id: string // name
  summary: string
  server_url: string
  method: string
  parameters: ParamItem[]
}

export type WorkflowToolProviderParameter = {
  name: string
  form: string
  description: string
  required?: boolean
  type?: string
}

export type WorkflowToolProviderRequest = {
  name: string
  icon: Emoji
  description: string
  parameters: WorkflowToolProviderParameter[]
  labels: string[]
  privacy_policy: string
}

export type WorkflowToolProviderResponse = {
  workflow_app_id: string
  workflow_tool_id: string
  label: string
  name: string
  icon: Emoji
  description: string
  synced: boolean
  tool: {
    author: string
    name: string
    label: TypeWithI18N
    description: TypeWithI18N
    labels: string[]
    parameters: ParamItem[]
  }
  privacy_policy: string
}

export type MCPServerDetail = {
  id: string
  server_code: string
  description: string
  status: string
  parameters?: Record<string, string>
}
