import type { CommonNodeType, VarType, Variable } from '@/app/components/workflow/types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'

export type ArrayElementType = 'string' | 'number' | 'boolean' | 'object'

export const getArrayElementType = (arrayType: `array[${ArrayElementType}]`): ArrayElementType => {
  const match = arrayType.match(/^array\[(.+)\]$/)
  return (match?.[1] as ArrayElementType) || 'string'
}

export type WebhookParameter = {
  name: string
  type: VarType
  required: boolean
}

export type WebhookHeader = {
  name: string
  required: boolean
}

export type WebhookTriggerNodeType = CommonNodeType & {
  webhook_url?: string
  webhook_debug_url?: string
  method: HttpMethod
  content_type: string
  headers: WebhookHeader[]
  params: WebhookParameter[]
  body: WebhookParameter[]
  async_mode: boolean
  status_code: number
  response_body: string
  variables: Variable[]
}
