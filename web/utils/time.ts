import type { ConfigType } from 'dayjs'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

export const isAfter = (date: ConfigType, compare: ConfigType) => {
  return dayjs(date).isAfter(dayjs(compare))
}

export const formatTime = ({ date, dateFormat }: { date: ConfigType, dateFormat: string }) => {
  return dayjs(date).format(dateFormat)
}

export const getDaysUntilEndOfMonth = (date: ConfigType = dayjs()) => {
  const current = dayjs(date).startOf('day')
  const endOfMonth = dayjs(date).endOf('month').startOf('day')
  const diff = endOfMonth.diff(current, 'day')
  return Math.max(diff, 0)
}
