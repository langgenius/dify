// Time model for schedule previews.
// A WallTime is a clock reading with no timezone. An instant is epoch milliseconds.
// All math here uses Date.UTC and Intl with an explicit timeZone, never browser-local Date fields,
// so the result does not depend on the browser timezone.

export type WallTime = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export const wallToUtcMs = (wall: WallTime): number =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)

export const wallFromUtcMs = (ms: number): WallTime => {
  const date = new Date(ms)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  }
}

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

// 0 = Sunday
export const dayOfWeek = (year: number, month: number, day: number): number =>
  new Date(Date.UTC(year, month - 1, day)).getUTCDay()

const formatters = new Map<string, Intl.DateTimeFormat>()
const getPartsFormatter = (timezone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(timezone, formatter)
  }
  return formatter
}

// Clock reading in the timezone at the instant, in UTC-based milliseconds, seconds included.
const wallMsAt = (instant: number, timezone: string): number => {
  const parts = getPartsFormatter(timezone).formatToParts(new Date(instant))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value)
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
}

export const toWall = (instant: number, timezone: string): WallTime =>
  wallFromUtcMs(wallMsAt(instant, timezone))

// Clock reading with seconds, as UTC-based milliseconds. Used where the seconds matter.
export const toWallMs = (instant: number, timezone: string): number => wallMsAt(instant, timezone)

export const offsetMinutesAt = (instant: number, timezone: string): number => {
  const wholeSecond = Math.floor(instant / 1000) * 1000
  return Math.round((wallMsAt(wholeSecond, timezone) - wholeSecond) / MINUTE_MS)
}

const sameWall = (a: WallTime, b: WallTime) =>
  a.year === b.year &&
  a.month === b.month &&
  a.day === b.day &&
  a.hour === b.hour &&
  a.minute === b.minute

// All instants that show this wall time, earliest first.
// 0 instants: the wall time falls in a DST gap. 2 instants: the wall time repeats in a DST fold.
export const toInstants = (wall: WallTime, timezone: string): number[] => {
  const wallMs = wallToUtcMs(wall)
  // Offsets a day before, at and after cover both sides of any change near this wall time.
  const offsets = new Set(
    [wallMs - DAY_MS, wallMs, wallMs + DAY_MS].map((time) => offsetMinutesAt(time, timezone)),
  )
  const instants = [...offsets]
    .map((offset) => wallMs - offset * MINUTE_MS)
    .filter((instant) => sameWall(toWall(instant, timezone), wall))
  return [...new Set(instants)].sort((a, b) => a - b)
}
