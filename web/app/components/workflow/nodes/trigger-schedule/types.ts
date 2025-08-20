import type { CommonNodeType } from '@/app/components/workflow/types'

export type ScheduleMode = 'visual' | 'cron'

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'once'

export type VisualConfig = {
  time?: string
  datetime?: string
  days?: number[]
  weekdays?: string[]
  recur_every?: number
  recur_unit?: 'hours' | 'minutes'
  monthly_days?: (number | 'last')[]
}

export type ScheduleTriggerNodeType = CommonNodeType & {
  mode: ScheduleMode
  frequency: ScheduleFrequency
  cron_expression?: string
  visual_config?: VisualConfig
  timezone: string
  enabled: boolean
}
