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

    if (userTimezone === 'UTC')
      return `${String(hour24).padStart(2, '0')}:${String(minuteNum).padStart(2, '0')}`

    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth()
    const day = today.getDate()

    const userTime = new Date(year, month, day, hour24, minuteNum)

    const tempFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: userTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    const userTimeInTz = tempFormatter.format(userTime).replace(', ', 'T')
    const userTimeDate = new Date(userTimeInTz)
    const offset = userTime.getTime() - userTimeDate.getTime()
    const utcTime = new Date(userTime.getTime() + offset)

    return `${String(utcTime.getHours()).padStart(2, '0')}:${String(utcTime.getMinutes()).padStart(2, '0')}`
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
    const dateStr = today.toISOString().split('T')[0]
    const utcDate = new Date(`${dateStr}T${String(hourNum).padStart(2, '0')}:${String(minuteNum).padStart(2, '0')}:00.000Z`)

    return utcDate.toLocaleTimeString('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }
  catch {
    return utcTime
  }
}

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
