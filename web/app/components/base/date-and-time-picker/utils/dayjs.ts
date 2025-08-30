import dayjs, { type Dayjs } from 'dayjs'
import type { Day } from '../types'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import tz from '@/utils/timezone.json'

dayjs.extend(utc)
dayjs.extend(timezone)

export default dayjs

const monthMaps: Record<string, Day[]> = {}

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

export const getDateWithTimezone = (props: { date?: Dayjs, timezone?: string }) => {
  return props.date ? dayjs.tz(props.date, props.timezone) : dayjs().tz(props.timezone)
}

// Asia/Shanghai -> UTC+8
const DEFAULT_OFFSET_STR = 'UTC+0'
export const convertTimezoneToOffsetStr = (timezone?: string) => {
  if (!timezone)
    return DEFAULT_OFFSET_STR
  const tzItem = tz.find(item => item.value === timezone)
  if(!tzItem)
    return DEFAULT_OFFSET_STR
  return `UTC${tzItem.name.charAt(0)}${tzItem.name.charAt(2)}`
}

// Parse date with multiple format support
export const parseDateWithFormat = (dateString: string, format?: string): Dayjs | null => {
  if (!dateString) return null

  // If format is specified, use it directly
  if (format) {
    const parsed = dayjs(dateString, format, true)
    return parsed.isValid() ? parsed : null
  }

  // Try common date formats
  const formats = [
    'YYYY-MM-DD', // Standard format
    'YYYY/MM/DD', // Slash format
    'DD-MM-YYYY', // European format
    'DD/MM/YYYY', // European slash format
    'MM-DD-YYYY', // US format
    'MM/DD/YYYY', // US slash format
    'YYYY-MM-DDTHH:mm:ss.SSSZ', // ISO format
    'YYYY-MM-DDTHH:mm:ssZ', // ISO format (no milliseconds)
    'YYYY-MM-DD HH:mm:ss', // Standard datetime format
  ]

  for (const fmt of formats) {
    const parsed = dayjs(dateString, fmt, true)
    if (parsed.isValid())
      return parsed
  }

  return null
}

// Format date output with localization support
export const formatDateForOutput = (date: Dayjs, includeTime: boolean = false, locale: string = 'en-US'): string => {
  if (!date || !date.isValid()) return ''

  if (includeTime) {
    // Output format with time
    return date.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
  }
 else {
    // Date-only output format without timezone
    return date.format('YYYY-MM-DD')
  }
}
