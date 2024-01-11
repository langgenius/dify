import type { TypeWithI18N } from '../header/account-setting/model-provider-page/declarations'
export enum LOC {
  tools = 'tools',
  app = 'app',
}

export enum AuthType {
  none = 'none',
  apiKey = 'api_key',
}

export type Credential = {
  'auth_type': AuthType
  'api_key_header'?: string
  'api_key_value'?: string
}

export enum CollectionType {
  all = 'all',
  builtIn = 'builtin',
  custom = 'api',
}

export type Collection = {
  name: string
  author: string
  description: TypeWithI18N
  icon: string | {
    background: string
    content: string
  }
  label: TypeWithI18N
  type: CollectionType
  team_credentials: Record<string, any>
  is_team_authorization: boolean
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
  description: {
    zh_Hans: string
    en_US: string
  }
  parameters: ToolParameter[]
}
