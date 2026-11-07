const timePattern = /^(\d{2}):(\d{2})$/

type TimeParts = { hour: number; minute: number }

function parseTimeValue(value: string): TimeParts | null {
  const match = timePattern.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour < 24 && minute < 60 ? { hour, minute } : null
}

function formatTimeValue({ hour, minute }: TimeParts): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function requireTimeValue(value: string | null): TimeParts | null {
  if (value === null) return null
  const time = parseTimeValue(value)
  if (!time) throw new RangeError(`Invalid time of day: ${value}`)
  return time
}

export { formatTimeValue, parseTimeValue, requireTimeValue }
export type { TimeParts }
