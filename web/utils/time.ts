import dayjs, { type ConfigType } from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)

export const isAfter = (date: ConfigType, compare: ConfigType) => {
  return dayjs(date).isAfter(dayjs(compare))
}

export const formatTime = ({ date, dateFormat }: { date: ConfigType; dateFormat: string }) => {
  return dayjs(date).format(dateFormat)
}
