import { TZDate, tzOffset, tzScan } from '@date-fns/tz'
import { parseDateValue } from '../date-picker/date-value'
import { parseTimeValue } from '../time-picker/time-value'

type ZonedWallTime = { date: string; time: string }

function getZonedWallTime(value: Date, timeZone: string): ZonedWallTime {
  const zoned = new TZDate(value.getTime(), timeZone)
  const date = `${String(zoned.getFullYear()).padStart(4, '0')}-${String(zoned.getMonth() + 1).padStart(2, '0')}-${String(zoned.getDate()).padStart(2, '0')}`
  const time = `${String(zoned.getHours()).padStart(2, '0')}:${String(zoned.getMinutes()).padStart(2, '0')}`
  return { date, time }
}

function getPossibleInstants({ date, time }: ZonedWallTime, timeZone: string): Date[] {
  const civil = parseDateValue(date)
  const clock = parseTimeValue(time)
  if (!civil || !clock) return []

  const localDate = new Date(0)
  localDate.setUTCFullYear(civil.getFullYear(), civil.getMonth(), civil.getDate())
  localDate.setUTCHours(clock.hour, clock.minute, 0, 0)
  const localEpoch = localDate.getTime()
  const start = new Date(localEpoch - 48 * 60 * 60 * 1000)
  const end = new Date(localEpoch + 48 * 60 * 60 * 1000)
  const offsets = new Set([tzOffset(timeZone, start), tzOffset(timeZone, end)])
  for (const transition of tzScan(timeZone, { start, end })) {
    offsets.add(transition.offset)
    offsets.add(transition.offset - transition.change)
  }

  return [...offsets]
    .map((offset) => new Date(localEpoch - offset * 60 * 1000))
    .filter((candidate) => {
      const wall = getZonedWallTime(candidate, timeZone)
      return wall.date === date && wall.time === time
    })
    .sort((a, b) => a.getTime() - b.getTime())
}

function resolveZonedWallTime(
  wall: ZonedWallTime,
  timeZone: string,
  preferredInstant?: Date | null,
): Date | null {
  if (preferredInstant) {
    const original = getZonedWallTime(preferredInstant, timeZone)
    if (original.date === wall.date && original.time === wall.time) return preferredInstant
  }
  return getPossibleInstants(wall, timeZone)[0] ?? null
}

export { getPossibleInstants, getZonedWallTime, resolveZonedWallTime }
export type { ZonedWallTime }
