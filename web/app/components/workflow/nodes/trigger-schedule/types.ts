import type { CommonNodeType } from '@/app/components/workflow/types'

export type ScheduleTriggerNodeType = CommonNodeType & {
  cron_expression?: string
  timezone?: string
  enabled?: boolean
}
