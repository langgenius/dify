import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export type LogCustomDateRange = { start: string; end: string }

export function customLogDateRange(range: LogCustomDateRange, timezone: string) {
  return {
    start: dayjs.tz(range.start, timezone).startOf('day'),
    end: dayjs.tz(range.end, timezone).endOf('day'),
  }
}
