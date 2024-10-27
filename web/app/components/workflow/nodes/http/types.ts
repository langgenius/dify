import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export enum Method {
  get = 'get',
  post = 'post',
  head = 'head',
  patch = 'patch',
  put = 'put',
  delete = 'delete',
}

export enum BodyType {
  none = 'none',
  formData = 'form-data',
  xWwwFormUrlencoded = 'x-www-form-urlencoded',
  rawText = 'raw-text',
  json = 'json',
}

export type KeyValue = {
  id?: string
  key: string
  value: string
}

export type Body = {
  type: BodyType
  data: string
}

export enum AuthorizationType {
  none = 'no-auth',
  apiKey = 'api-key',
}

export enum APIType {
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
}

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
}
