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

export const convertTimezoneToOffsetStr = (timezone?: string) => {
  if (!timezone) return DEFAULT_OFFSET_STR
  const tzItem = tz.find((item) => item.value === timezone)
  if (!tzItem) return DEFAULT_OFFSET_STR
  // Extract offset from name format like "-11:00 Niue Time" or "+05:30 India Time"
  // Name format is always "{offset}:{minutes} {timezone name}"
  const offsetMatch = /^([+-]?\d{1,2}):(\d{2})/.exec(tzItem.name)
  /* v8 ignore next 2 -- timezone.json entries are normalized to "{offset} {name}"; this protects against malformed data only. */
  if (!offsetMatch) return DEFAULT_OFFSET_STR
  // Parse hours and minutes separately
  const hours = Number.parseInt(offsetMatch[1]!, 10)
  const minutes = Number.parseInt(offsetMatch[2]!, 10)
  const sign = hours >= 0 ? '+' : ''
  // If minutes are non-zero, include them in the output (e.g., "UTC+5:30")
  // Otherwise, only show hours (e.g., "UTC+8")
  return minutes !== 0 ? `UTC${sign}${hours}:${offsetMatch[2]}` : `UTC${sign}${hours}`
}
