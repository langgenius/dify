import type { CommonNodeType, InputVar } from '@/app/components/workflow/types'
import type { DefaultValueForm } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import type { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'

export type ParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object'

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
  http_methods?: HttpMethod[]
  error_strategy?: ErrorHandleTypeEnum
  default_value?: DefaultValueForm[]
  variables: InputVar[]
}
