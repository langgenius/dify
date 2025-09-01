import type { CommonNodeType } from '@/app/components/workflow/types'

export type ScheduleMode = 'visual' | 'cron'

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly'

export type VisualConfig = {
  time?: string // User timezone time format: "2:30 PM"
  weekdays?: string[] // ['mon', 'tue', 'wed'] for weekly frequency
  on_minute?: number // 0-59 for hourly frequency
  monthly_days?: (number | 'last')[] // [1, 15, 'last'] for monthly frequency
}

export type ScheduleTriggerNodeType = CommonNodeType & {
  mode: ScheduleMode // 'visual' or 'cron' configuration mode
  frequency: ScheduleFrequency // 'hourly' | 'daily' | 'weekly' | 'monthly'
  cron_expression?: string // Cron expression when mode is 'cron'
  visual_config?: VisualConfig // User-friendly configuration when mode is 'visual'
  timezone: string // User profile timezone (e.g., 'Asia/Shanghai', 'America/New_York')
}
