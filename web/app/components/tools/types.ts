import type { TypeWithI18N } from '../header/account-setting/model-provider-page/declarations'
export enum LOC {
  tools = 'tools',
  app = 'app',
}

export enum AuthType {
  none = 'none',
  apiKey = 'api_key',
}

export enum AuthHeaderPrefix {
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
}

export type Credential = {
  'auth_type': AuthType
  'api_key_header'?: string
  'api_key_value'?: string
  'api_key_header_prefix'?: AuthHeaderPrefix
}

export enum CollectionType {
  all = 'all',
  builtIn = 'builtin',
  custom = 'api',
  model = 'model',
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
}

export type ToolParameter = {
  name: string
  label: TypeWithI18N
  human_description: TypeWithI18N
  type: string
  required: boolean
  default: string
  options?: {
    label: TypeWithI18N
    value: string
  }[]
}

export type Tool = {
  name: string
  label: TypeWithI18N
  description: any
  parameters: ToolParameter[]
}

export type ToolCredential = {
  name: string
  label: TypeWithI18N
  help: TypeWithI18N
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
  tools?: ParamItem[]
}

export type ParamItem = {
  name: string
  label: TypeWithI18N
  human_description: TypeWithI18N
  type: string
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
