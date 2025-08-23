export const isUTCFormat = (time: string): boolean => {
  return /^\d{2}:\d{2}$/.test(time)
}

export const isUserFormat = (time: string): boolean => {
  return /^\d{1,2}:\d{2} (AM|PM)$/.test(time)
}

const getTimezoneOffset = (timezone: string): number => {
  try {
    const now = new Date()
    const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
    const target = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    return (target.getTime() - utc.getTime()) / (1000 * 60)
  }
  catch {
    return 0
  }
}

export const getCurrentTimeInTimezone = (timezone: string): Date => {
  try {
    const now = new Date()
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000)
    const targetTime = new Date(utcTime + (getTimezoneOffset(timezone) * 60000))
    return targetTime
  }
  catch {
    return new Date()
  }
}

export const formatDateInTimezone = (date: Date, timezone: string, includeWeekday: boolean = true): string => {
  try {
    const dateOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timezone,
    }

    if (includeWeekday)
      dateOptions.weekday = 'short'

    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }

    return `${date.toLocaleDateString('en-US', dateOptions)} ${date.toLocaleTimeString('en-US', timeOptions)}`
  }
  catch {
    return date.toLocaleString()
  }
}
