import type { CommonNodeType, ValueSelector, Variable } from '@/app/components/workflow/types'

export const Method = {
  get: 'get',
  post: 'post',
  head: 'head',
  patch: 'patch',
  put: 'put',
  delete: 'delete',
} as const

export type Method = (typeof Method)[keyof typeof Method]

export const BodyType = {
  none: 'none',
  formData: 'form-data',
  xWwwFormUrlencoded: 'x-www-form-urlencoded',
  rawText: 'raw-text',
  json: 'json',
  binary: 'binary',
} as const

export type BodyType = (typeof BodyType)[keyof typeof BodyType]

export type KeyValue = {
  id?: string
  key: string
  value: string
  type?: string
  file?: ValueSelector
}

export const BodyPayloadValueType = {
  text: 'text',
  file: 'file',
} as const

export type BodyPayloadValueType = (typeof BodyPayloadValueType)[keyof typeof BodyPayloadValueType]

export type BodyPayload = {
  id?: string
  key?: string
  type: BodyPayloadValueType
  file?: ValueSelector // when type is file
  value?: string // when type is text
}[]
export type Body = {
  type: BodyType
  data: string | BodyPayload // string is deprecated, it would convert to BodyPayload after loaded
}

export const AuthorizationType = {
  none: 'no-auth',
  apiKey: 'api-key',
} as const

export type AuthorizationType = (typeof AuthorizationType)[keyof typeof AuthorizationType]

export const APIType = {
  basic: 'basic',
  bearer: 'bearer',
  custom: 'custom',
} as const

export type APIType = (typeof APIType)[keyof typeof APIType]

export type Authorization = {
  type: AuthorizationType
  config?: {
    type: APIType
    api_key: string
    header?: string
  } | null
}

export type Timeout = {
  connect?: number
  read?: number
  write?: number
  max_connect_timeout?: number
  max_read_timeout?: number
  max_write_timeout?: number
}

export type HttpNodeType = CommonNodeType & {
  variables: Variable[]
  method: Method
  url: string
  headers: string
  params: string
  body: Body
  authorization: Authorization
  timeout: Timeout
  ssl_verify?: boolean
}
