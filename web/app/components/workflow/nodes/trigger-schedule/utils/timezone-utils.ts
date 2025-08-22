export const convertTimeToUTC = (time: string, userTimezone: string): string => {
  try {
    const [timePart, period] = time.split(' ')
    if (!timePart || !period) return time

    const [hour, minute] = timePart.split(':')
    if (!hour || !minute) return time

    let hour24 = Number.parseInt(hour, 10)
    const minuteNum = Number.parseInt(minute, 10)

    if (Number.isNaN(hour24) || Number.isNaN(minuteNum)) return time

    if (period === 'PM' && hour24 !== 12) hour24 += 12
    if (period === 'AM' && hour24 === 12) hour24 = 0

    const today = new Date()
    const userDate = new Date()
    userDate.setFullYear(today.getFullYear(), today.getMonth(), today.getDate())
    userDate.setHours(hour24, minuteNum, 0, 0)

    const utcDate = new Date(userDate.toLocaleString('en-US', { timeZone: 'UTC' }))
    const userTimezoneDate = new Date(userDate.toLocaleString('en-US', { timeZone: userTimezone }))
    const offset = userTimezoneDate.getTime() - utcDate.getTime()
    const utcTime = new Date(userDate.getTime() - offset)

    const result = utcTime.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    })

    if (result.includes('Invalid')) return time
    return result
  }
  catch {
    return time
  }
}

export const convertUTCToUserTimezone = (utcTime: string, userTimezone: string): string => {
  try {
    const [hour, minute] = utcTime.split(':')
    if (!hour || !minute) return utcTime

    const hourNum = Number.parseInt(hour, 10)
    const minuteNum = Number.parseInt(minute, 10)

    if (Number.isNaN(hourNum) || Number.isNaN(minuteNum)) return utcTime

    const today = new Date()
    const utcDate = new Date()
    utcDate.setUTCFullYear(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    utcDate.setUTCHours(hourNum, minuteNum, 0, 0)

    const result = utcDate.toLocaleTimeString('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })

    if (result.includes('Invalid')) return utcTime
    return result
  }
  catch {
    return utcTime
  }
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
