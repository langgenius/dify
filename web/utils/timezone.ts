import tz from './timezone.json'

type Item = {
  value: string
  name: string
}
export const timezones: Item[] = tz

export const getBrowserTimezone = () => {
  if (typeof Intl === 'undefined') return undefined

  return new Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
}

const DEFAULT_OFFSET_STR = 'UTC+0'

const formatOffset = (totalMinutes: number) => {
  const sign = totalMinutes >= 0 ? '+' : '-'
  const absMinutes = Math.abs(totalMinutes)
  const hours = Math.floor(absMinutes / 60)
  const minutes = absMinutes % 60
  return minutes !== 0
    ? `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`
    : `UTC${sign}${hours}`
}

// Offset in minutes of a timezone at a given instant, following DST. Undefined if the runtime cannot resolve it.
export const getTimezoneOffsetMinutes = (timezone: string, date: Date): number | undefined => {
  try {
    const name = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value
    if (name === 'GMT') return 0
    const match = name ? /^GMT([+-])(\d{2}):(\d{2})$/.exec(name) : null
    if (!match) return undefined
    const totalMinutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -totalMinutes : totalMinutes
  } catch {
    return undefined
  }
}

export const convertTimezoneToOffsetStr = (timezone?: string, date: Date = new Date()) => {
  if (!timezone) return DEFAULT_OFFSET_STR
  const offsetMinutes = getTimezoneOffsetMinutes(timezone, date)
  if (offsetMinutes !== undefined) return formatOffset(offsetMinutes)
  const tzItem = tz.find((item) => item.value === timezone)
  if (!tzItem) return DEFAULT_OFFSET_STR
  // Fallback for runtimes without the timezone. Extract the standard offset from names like "-11:00 Niue Time".
  const offsetMatch = /^([+-]?\d{1,2}):(\d{2})/.exec(tzItem.name)
  /* v8 ignore next 2 -- timezone.json entries are normalized to "{offset} {name}"; this protects against malformed data only. */
  if (!offsetMatch) return DEFAULT_OFFSET_STR
  const hours = Number.parseInt(offsetMatch[1]!, 10)
  const minutes = Number.parseInt(offsetMatch[2]!, 10)
  const sign = hours >= 0 ? '+' : ''
  return minutes !== 0 ? `UTC${sign}${hours}:${offsetMatch[2]}` : `UTC${sign}${hours}`
}
