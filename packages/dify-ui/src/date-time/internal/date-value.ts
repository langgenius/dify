import { tz } from '@date-fns/tz'
import { format, isValid, parseISO } from 'date-fns'

function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null
  const date = parseISO(value, { in: tz('UTC') })
  return isValid(date) ? date : null
}

function formatDateValue(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function requireDateValue(value: string | null): Date | null {
  if (value === null) return null
  const date = parseDateValue(value)
  if (!date) throw new RangeError(`Invalid calendar date: ${value}`)
  return date
}

function getInitialMonth(date: string, minDate?: string, maxDate?: string): string {
  const visibleDate =
    minDate && date < minDate ? minDate : maxDate && date > maxDate ? maxDate : date
  return `${visibleDate.slice(0, 7)}-01`
}

export { formatDateValue, getInitialMonth, parseDateValue, requireDateValue }
