import dayjs, { type Dayjs } from 'dayjs'
import type { Day } from '../types'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

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
