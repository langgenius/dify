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

export const convertLocalSecondsToUTCDaySeconds = (
  secondsInDay: number,
  localTimezone: string,
): number => {
  // The API stores a daily UTC clock, not a date. Use the same current offset in both directions.
  const offset = dayjs().tz(localTimezone).utcOffset()
  const utcTargetTime = dayjs
    .utc()
    .startOf('day')
    .add(secondsInDay - offset * 60, 'second')
  return utcTargetTime.hour() * 3600 + utcTargetTime.minute() * 60 + utcTargetTime.second()
}

export const convertUTCDaySecondsToLocalSeconds = (
  utcDaySeconds: number,
  localTimezone: string,
): number => {
  const utcDayStart = dayjs().utc().startOf('day')
  const utcTargetTime = utcDayStart.add(utcDaySeconds, 'second')
  const localTargetTime = utcTargetTime.utcOffset(dayjs().tz(localTimezone).utcOffset())
  return localTargetTime.hour() * 3600 + localTargetTime.minute() * 60 + localTargetTime.second()
}
