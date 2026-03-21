import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export const timeOfDayToDayjs = (timeOfDay: number): Dayjs => {
  const hours = Math.floor(timeOfDay / 3600)
  const minutes = (timeOfDay - hours * 3600) / 60
  const res = dayjs().startOf('day').hour(hours).minute(minutes)
  return res
}

export const convertLocalSecondsToUTCDaySeconds = (secondsInDay: number, localTimezone: string): number => {
  const localDayStart = dayjs().tz(localTimezone).startOf('day')
  const localTargetTime = localDayStart.add(secondsInDay, 'second')
  const utcTargetTime = localTargetTime.utc()
  const utcDayStart = utcTargetTime.startOf('day')
  const secondsFromUTCMidnight = utcTargetTime.diff(utcDayStart, 'second')
  return secondsFromUTCMidnight
}

export const dayjsToTimeOfDay = (date?: Dayjs): number => {
  if (!date)
    return 0
  return date.hour() * 3600 + date.minute() * 60
}

export const convertUTCDaySecondsToLocalSeconds = (utcDaySeconds: number, localTimezone: string): number => {
  const utcDayStart = dayjs().utc().startOf('day')
  const utcTargetTime = utcDayStart.add(utcDaySeconds, 'second')
  const localTargetTime = utcTargetTime.tz(localTimezone)
  const localDayStart = localTargetTime.startOf('day')
  const secondsInLocalDay = localTargetTime.diff(localDayStart, 'second')
  return secondsInLocalDay
}
