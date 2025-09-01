import type { CommonNodeType, InputVar } from '@/app/components/workflow/types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'

export type ParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'file'

export type WebhookParameter = {
  name: string
  type: ParameterType
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
  variables: InputVar[]
}
