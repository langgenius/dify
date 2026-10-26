import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

export type ActivityRange = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom'
export type ActivityOperator = 'all' | 'system' | `member:${string}`
export type ActivityDateRange = { end: Dayjs; start: Dayjs }

export function activityDatesForRange(range: Exclude<ActivityRange, 'custom'>): ActivityDateRange {
  const end = dayjs().endOf('day')
  if (range === 'all') return { end, start: dayjs(0) }
  if (range === 'today') return { end, start: dayjs().startOf('day') }
  return {
    end,
    start: dayjs()
      .subtract(Number.parseInt(range) - 1, 'day')
      .startOf('day'),
  }
}
