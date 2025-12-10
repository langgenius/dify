import type { ScheduleTriggerNodeType } from './types'

export const getDefaultScheduleConfig = (): Partial<ScheduleTriggerNodeType> => ({
  mode: 'visual',
  frequency: 'daily',
  visual_config: {
    time: '12:00 AM',
    weekdays: ['sun'],
    on_minute: 0,
    monthly_days: [1],
  },
})

export const getDefaultVisualConfig = () => ({
  time: '12:00 AM',
  weekdays: ['sun'],
  on_minute: 0,
  monthly_days: [1],
})
