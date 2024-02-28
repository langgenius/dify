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
  key: string
  value: string
}

export type Body = {
  type: BodyType
  data: string
}

export type HttpNodeType = CommonNodeType & {
  variables: Variable[]
  method: Method
  url: string
  headers: string
  params: string
  body: Body
}
