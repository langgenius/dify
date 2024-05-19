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
  workflow = 'workflow',
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

export type Tool = {
  name: string
  author: string
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
  custom_disclaimer: string
  tools?: ParamItem[]
  id: string
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

export const MOCK_WORKFLOW_TOOL = {
  id: '67f1d351-4fa0-4b1c-9eca-d10988caa174',
  type: 'workflow',
  name: 'WF03',
  label: { zh_Hans: 'WF03', en_US: 'WF03', pt_BR: 'WF03' },
  description: {
    zh_Hans: 'A workflow tool, boy~',
    en_US: 'A workflow tool, boy~',
    pt_BR: 'A workflow tool, boy~',
  },
  icon: {
    content: '🕵️',
    background: '#FEF7C3',
  },
  author: 'KVOJJJin',
  allow_delete: true,
  is_team_authorization: true,
  team_credentials: {},
  labels: [],
  tools: [
    {
      author: 'Yeuoly Yeuoly Chou',
      name: 'test_workflow',
      label: {
        zh_Hans: 'workflow as tool',
        pt_BR: 'workflow as tool',
        en_US: 'workflow as tool',
      },
      description: {
        zh_Hans: 'workflow as tool',
        pt_BR: 'workflow as tool',
        en_US: 'workflow as tool',
      },
      parameters: [
        {
          name: 'a',
          label: {
            zh_Hans: 'aa',
            pt_BR: 'aa',
            en_US: 'aa',
          },
          human_description: {
            zh_Hans: 'a parameter',
            pt_BR: 'a parameter',
            en_US: 'a parameter',
          },
          type: 'string',
          form: 'llm',
          llm_description: 'a parameter',
          required: true,
          default: null,
          min: null,
          max: null,
          options: null,
        },
      ],
    },
  ],
}
