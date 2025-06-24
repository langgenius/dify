import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

export const timeOfDayToDayjs = (timeOfDay: number): Dayjs => {
  const hours = Math.floor(timeOfDay / 3600)
  const minutes = (timeOfDay - hours * 3600) / 60
  const res = dayjs().startOf('day').hour(hours).minute(minutes)
  return res
}

export const dayjsToTimeOfDay = (date?: Dayjs): number => {
  if(!date) return 0
  return date.hour() * 3600 + date.minute() * 60
}
