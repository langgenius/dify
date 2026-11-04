export function parseClockTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value)
  if (!match) return '00:00'
  const hour = (Number(match[1]) % 12) + (match[3]!.toUpperCase() === 'PM' ? 12 : 0)
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}
export function formatClockTime(value: string): string {
  const hour = Number(value.slice(0, 2))
  return `${hour % 12 || 12}:${value.slice(3)} ${hour < 12 ? 'AM' : 'PM'}`
}
