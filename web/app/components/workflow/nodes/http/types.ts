import type { CommonNodeType, Variable } from '@/app/components/workflow/types'

export enum MethodEnum {
  get = 'get',
  post = 'post',
  head = 'head',
  patch = 'patch',
  put = 'put',
  delete = 'delete',
}

export type KeyValue = {
  key: string
  value: string
}

export type HttpNodeType = CommonNodeType & {
  variables: Variable[]
  method: MethodEnum
  url: string
  headers: string
  params: string
  body: {
    type: string
    data: string
  }
}
