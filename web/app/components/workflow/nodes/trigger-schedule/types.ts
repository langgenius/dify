import type { CommonNodeType } from '@/app/components/workflow/types'

export type ScheduleMode = 'visual' | 'cron'

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly'

export type VisualConfig = {
  time?: string
  weekdays?: string[]
  on_minute?: number
  monthly_days?: (number | 'last')[]
}

export type ScheduleTriggerNodeType = CommonNodeType & {
  mode: ScheduleMode
  frequency?: ScheduleFrequency
  cron_expression?: string
  visual_config?: VisualConfig
  timezone?: string
}
