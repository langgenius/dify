export const convertTimeToUserTimezone = (time: string, userTimezone: string): string => {
  try {
    const now = new Date()
    const [timePart, period] = time.split(' ')
    const [hour, minute] = timePart.split(':')
    let hour24 = Number.parseInt(hour, 10)

    if (period === 'PM' && hour24 !== 12) hour24 += 12
    if (period === 'AM' && hour24 === 12) hour24 = 0

    const utcDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour24, Number.parseInt(minute, 10), 0, 0)

    const userDate = new Date(utcDate.toLocaleString('en-US', { timeZone: userTimezone }))

    return userDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }
 catch {
    return time
  }
}

export const convertTimeToUTC = (time: string, _userTimezone: string): string => {
  try {
    const now = new Date()
    const [timePart, period] = time.split(' ')
    const [hour, minute] = timePart.split(':')
    let hour24 = Number.parseInt(hour, 10)

    if (period === 'PM' && hour24 !== 12) hour24 += 12
    if (period === 'AM' && hour24 === 12) hour24 = 0

    const userDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour24, Number.parseInt(minute, 10), 0, 0)

    const utcTime = new Date(userDate.getTime() - (userDate.getTimezoneOffset() * 60000))

    return utcTime.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
    })
  }
 catch {
    return time
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
