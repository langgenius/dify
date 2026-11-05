import type { ScheduleTriggerNodeType } from '../types'
import { convertTimezoneToOffsetStr } from '@/utils/timezone'
import { getNextRunInstants, isValidCronExpression } from './cron-parser'
import { toWall, wallToUtcMs } from './time-model'

const DEFAULT_TIMEZONE = 'UTC'

const resolveTimezone = (timezone?: string): string => {
  if (timezone) return timezone

  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

// "2:30 PM" -> { hour: 14, minute: 30 }, the same as convert_12h_to_24h on the backend.
const to24Hour = (time: string) => {
  const [clock = '', period = ''] = time.trim().split(/\s+/)
  const [hour = 0, minute = 0] = clock.split(':').map(Number)
  return { hour: (hour % 12) + (period.toUpperCase() === 'PM' ? 12 : 0), minute }
}

const WEEKDAY_NUMBERS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

// Visual settings as a cron expression, with the same mapping as ScheduleService.visual_to_cron.
const visualToCron = (data: ScheduleTriggerNodeType): string | null => {
  const config = data.visual_config
  if (data.frequency === 'hourly') return `${config?.on_minute ?? 0} * * * *`

  const { hour, minute } = to24Hour(config?.time || '12:00 AM')
  if (data.frequency === 'daily') return `${minute} ${hour} * * *`

  if (data.frequency === 'weekly') {
    const weekdays = (config?.weekdays || ['sun'])
      .map((day) => WEEKDAY_NUMBERS[day])
      .filter((day): day is number => day !== undefined)
    if (weekdays.length === 0) return null
    return `${minute} ${hour} * * ${[...new Set(weekdays)].sort((a, b) => a - b).join(',')}`
  }

  if (data.frequency === 'monthly') {
    const selected = config?.monthly_days?.length ? config.monthly_days : [1]
    const numbers = [...new Set(selected.filter((day): day is number => day !== 'last'))].sort(
      (a, b) => a - b,
    )
    const days = [...numbers.map(String), ...(selected.includes('last') ? ['L'] : [])]
    return `${minute} ${hour} ${days.join(',')} * *`
  }

  return null
}

const getScheduleCron = (data: ScheduleTriggerNodeType): string | null => {
  if (data.mode === 'cron') {
    if (!data.cron_expression || !isValidCronExpression(data.cron_expression)) return null
    return data.cron_expression
  }
  return visualToCron(data)
}

const getNextRuns = (data: ScheduleTriggerNodeType, count: number): number[] => {
  const cron = getScheduleCron(data)
  if (!cron) return []
  return getNextRunInstants(cron, resolveTimezone(data.timezone), count)
}

// Format an instant as the clock reads in the schedule timezone.
const formatInstant = (
  instant: number,
  timezone: string,
  includeWeekday: boolean,
  includeTimezone: boolean,
): string => {
  const date = new Date(instant)
  const dateStr = date.toLocaleDateString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(includeWeekday ? { weekday: 'long' as const } : {}),
  })
  const timeStr = date.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  if (includeTimezone) {
    return `${dateStr}, ${timeStr} (${convertTimezoneToOffsetStr(timezone, date)})`
  }

  return `${dateStr}, ${timeStr}`
}

const shouldIncludeWeekday = (data: ScheduleTriggerNodeType) =>
  data.mode === 'visual' && data.frequency === 'weekly'

// Real run instants, the same ones the backend scheduler uses.
export const getNextExecutionTimes = (data: ScheduleTriggerNodeType, count: number = 5): Date[] =>
  getNextRuns(data, count).map((instant) => new Date(instant))

export const getFormattedExecutionTimes = (
  data: ScheduleTriggerNodeType,
  count: number = 5,
): string[] => {
  const timezone = resolveTimezone(data.timezone)
  return getNextRuns(data, count).map((instant) =>
    formatInstant(instant, timezone, shouldIncludeWeekday(data), true),
  )
}

export const getNextExecutionTime = (data: ScheduleTriggerNodeType): string => {
  const timezone = resolveTimezone(data.timezone)

  // Return placeholder for cron mode with empty or invalid expression
  if (data.mode === 'cron') {
    if (!data.cron_expression || !isValidCronExpression(data.cron_expression)) return '--'
  }

  const [next] = getNextRuns(data, 1)
  if (next !== undefined) return formatInstant(next, timezone, shouldIncludeWeekday(data), false)

  // No run found: show today at 12:00 PM in the schedule timezone.
  const fallback = wallToUtcMs({ ...toWall(Date.now(), timezone), hour: 12, minute: 0 })
  return formatInstant(fallback, 'UTC', shouldIncludeWeekday(data), false)
}
