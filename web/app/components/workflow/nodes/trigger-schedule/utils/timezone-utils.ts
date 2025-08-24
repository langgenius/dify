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
