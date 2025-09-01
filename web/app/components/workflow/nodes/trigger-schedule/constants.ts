import type { ScheduleTriggerNodeType } from './types'

// Unified default values for trigger schedule
export const getDefaultScheduleConfig = (): Partial<ScheduleTriggerNodeType> => ({
  mode: 'visual',
  frequency: 'weekly',
  visual_config: {
    time: '11:30 AM',
    weekdays: ['sun'],
    on_minute: 0,
    monthly_days: [1],
  },
})

export const getDefaultVisualConfig = () => ({
  time: '11:30 AM',
  weekdays: ['sun'],
  on_minute: 0,
  monthly_days: [1],
})
