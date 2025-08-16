import type { CommonNodeType } from '@/app/components/workflow/types'

export type WebhookTriggerNodeType = CommonNodeType & {
  webhook_url?: string
  http_methods?: string[]
  authorization?: {
    type: 'none' | 'bearer' | 'api_key'
    config?: Record<string, any>
  }
}
