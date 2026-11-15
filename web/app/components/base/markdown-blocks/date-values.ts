import { parseDateValue } from '../date-time-picker/date-value'

export function parseFormTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?\s*(AM|PM)?$/i.exec(value.trim())
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2])
  if (minute > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return undefined
  if (match[3]) hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
export function parseFormInstant(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !parseDateValue(value.slice(0, 10))) return undefined
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? undefined : instant
}
