import type { Dayjs } from 'dayjs'
import type { Day } from '../types'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { IS_PROD } from '@/config'
import tz from '@/utils/timezone.json'

dayjs.extend(utc)
dayjs.extend(timezone)

export default dayjs

const monthMaps: Record<string, Day[]> = {}
const DEFAULT_OFFSET_STR = 'UTC+0'
const TIME_ONLY_REGEX = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
const TIME_ONLY_12H_REGEX = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?(AM|PM)$/i

const COMMON_PARSE_FORMATS = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD-MM-YYYY',
  'DD/MM/YYYY',
  'MM-DD-YYYY',
  'MM/DD/YYYY',
  'YYYY-MM-DDTHH:mm:ss.SSSZ',
  'YYYY-MM-DDTHH:mm:ssZ',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY-MM-DDTHH:mm',
  'YYYY-MM-DDTHH:mmZ',
  'YYYY-MM-DDTHH:mm:ss',
  'YYYY-MM-DDTHH:mm:ss.SSS',
]

export const cloneTime = (targetDate: Dayjs, sourceDate: Dayjs) => {
  return targetDate.clone()
    .set('hour', sourceDate.hour())
    .set('minute', sourceDate.minute())
}

export const getDaysInMonth = (currentDate: Dayjs) => {
  const key = currentDate.format('YYYY-MM')
  // return the cached days
  if (monthMaps[key])
    return monthMaps[key]

  const daysInCurrentMonth = currentDate.daysInMonth()
  const firstDay = currentDate.startOf('month').day()
  const lastDay = currentDate.endOf('month').day()
  const lastDayInLastMonth = currentDate.clone().subtract(1, 'month').endOf('month')
  const firstDayInNextMonth = currentDate.clone().add(1, 'month').startOf('month')
  const days: Day[] = []
  const daysInOneWeek = 7
  const totalLines = 6

  // Add cells for days before the first day of the month
  for (let i = firstDay - 1; i >= 0; i--) {
    const date = cloneTime(lastDayInLastMonth.subtract(i, 'day'), currentDate)
    days.push({
      date,
      isCurrentMonth: false,
    })
  }

  // Add days of the month
  for (let i = 1; i <= daysInCurrentMonth; i++) {
    const date = cloneTime(currentDate.startOf('month').add(i - 1, 'day'), currentDate)
    days.push({
      date,
      isCurrentMonth: true,
    })
  }

  // Add cells for days after the last day of the month
  const totalLinesOfCurrentMonth = Math.ceil((daysInCurrentMonth - ((daysInOneWeek - firstDay) + lastDay + 1)) / 7) + 2
  const needAdditionalLine = totalLinesOfCurrentMonth < totalLines
  for (let i = 0; lastDay + i < (needAdditionalLine ? 2 * daysInOneWeek - 1 : daysInOneWeek - 1); i++) {
    const date = cloneTime(firstDayInNextMonth.add(i, 'day'), currentDate)
    days.push({
      date,
      isCurrentMonth: false,
    })
  }

  // cache the days
  monthMaps[key] = days
  return days
}

export const clearMonthMapCache = () => {
  for (const key in monthMaps)
    delete monthMaps[key]
}

export const getHourIn12Hour = (date: Dayjs) => {
  const hour = date.hour()
  return hour === 0 ? 12 : hour >= 12 ? hour - 12 : hour
}

export const getDateWithTimezone = ({ date, timezone }: { date?: Dayjs, timezone?: string }) => {
  if (!timezone)
    return (date ?? dayjs()).clone()
  return date ? dayjs.tz(date, timezone) : dayjs().tz(timezone)
}

export const convertTimezoneToOffsetStr = (timezone?: string) => {
  if (!timezone)
    return DEFAULT_OFFSET_STR
  const tzItem = tz.find(item => item.value === timezone)
  if (!tzItem)
    return DEFAULT_OFFSET_STR
  // Extract offset from name format like "-11:00 Niue Time" or "+05:30 India Time"
  // Name format is always "{offset}:{minutes} {timezone name}"
  const offsetMatch = tzItem.name.match(/^([+-]?\d{1,2}):(\d{2})/)
  if (!offsetMatch)
    return DEFAULT_OFFSET_STR
  // Parse hours and minutes separately
  const hours = Number.parseInt(offsetMatch[1], 10)
  const minutes = Number.parseInt(offsetMatch[2], 10)
  const sign = hours >= 0 ? '+' : ''
  // If minutes are non-zero, include them in the output (e.g., "UTC+5:30")
  // Otherwise, only show hours (e.g., "UTC+8")
  return minutes !== 0 ? `UTC${sign}${hours}:${offsetMatch[2]}` : `UTC${sign}${hours}`
}

export const isDayjsObject = (value: unknown): value is Dayjs => dayjs.isDayjs(value)

export type ToDayjsOptions = {
  timezone?: string
  format?: string
  formats?: string[]
}

const warnParseFailure = (value: string) => {
  if (!IS_PROD)
    console.warn('[TimePicker] Failed to parse time value', value)
}

const normalizeMillisecond = (value: string | undefined) => {
  if (!value)
    return 0
  if (value.length === 3)
    return Number(value)
  if (value.length > 3)
    return Number(value.slice(0, 3))
  return Number(value.padEnd(3, '0'))
}

const applyTimezone = (date: Dayjs, timezone?: string) => {
  return timezone ? getDateWithTimezone({ date, timezone }) : date
}

export const toDayjs = (value: string | Dayjs | undefined, options: ToDayjsOptions = {}): Dayjs | undefined => {
  if (!value)
    return undefined

  const { timezone: tzName, format, formats } = options

  if (isDayjsObject(value))
    return applyTimezone(value, tzName)

  if (typeof value !== 'string')
    return undefined

  const trimmed = value.trim()

  if (format) {
    const parsedWithFormat = tzName
      ? dayjs(trimmed, format, true).tz(tzName, true)
      : dayjs(trimmed, format, true)
    if (parsedWithFormat.isValid())
      return parsedWithFormat
  }

  const timeMatch = TIME_ONLY_REGEX.exec(trimmed)
  if (timeMatch) {
    const base = applyTimezone(dayjs(), tzName).startOf('day')
    const rawHour = Number(timeMatch[1])
    const minute = Number(timeMatch[2])
    const second = timeMatch[3] ? Number(timeMatch[3]) : 0
    const millisecond = normalizeMillisecond(timeMatch[4])

    return base
      .set('hour', rawHour)
      .set('minute', minute)
      .set('second', second)
      .set('millisecond', millisecond)
  }

  const timeMatch12h = TIME_ONLY_12H_REGEX.exec(trimmed)
  if (timeMatch12h) {
    const base = applyTimezone(dayjs(), tzName).startOf('day')
    let hour = Number(timeMatch12h[1]) % 12
    const isPM = timeMatch12h[4]?.toUpperCase() === 'PM'
    if (isPM)
      hour += 12
    const minute = Number(timeMatch12h[2])
    const second = timeMatch12h[3] ? Number(timeMatch12h[3]) : 0

    return base
      .set('hour', hour)
      .set('minute', minute)
      .set('second', second)
      .set('millisecond', 0)
  }

  const candidateFormats = formats ?? COMMON_PARSE_FORMATS
  for (const fmt of candidateFormats) {
    const parsed = tzName
      ? dayjs(trimmed, fmt, true).tz(tzName, true)
      : dayjs(trimmed, fmt, true)
    if (parsed.isValid())
      return parsed
  }

  const fallbackParsed = tzName ? dayjs.tz(trimmed, tzName) : dayjs(trimmed)
  if (fallbackParsed.isValid())
    return fallbackParsed

  warnParseFailure(value)
  return undefined
}

// Parse date with multiple format support
export const parseDateWithFormat = (dateString: string, format?: string): Dayjs | null => {
  if (!dateString)
    return null

  // If format is specified, use it directly
  if (format) {
    const parsed = dayjs(dateString, format, true)
    return parsed.isValid() ? parsed : null
  }

  // Try common date formats
  const formats = [
    ...COMMON_PARSE_FORMATS,
  ]

  for (const fmt of formats) {
    const parsed = dayjs(dateString, fmt, true)
    if (parsed.isValid())
      return parsed
  }

  return null
}

// Format date output with localization support
export const formatDateForOutput = (date: Dayjs, includeTime: boolean = false, _locale: string = 'en-US'): string => {
  if (!date || !date.isValid())
    return ''

  if (includeTime) {
    // Output format with time
    return date.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
  }
  else {
    // Date-only output format without timezone
    return date.format('YYYY-MM-DD')
  }
}
