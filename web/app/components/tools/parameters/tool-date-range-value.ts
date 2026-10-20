import { parseDateValue } from '@/app/components/base/date-time-picker/date-value'

export type ToolDateRangeStored = {
  start?: string
  end?: string
}

export function parseToolDateRangeValue(raw: unknown): ToolDateRangeStored {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const range = value as Record<string, unknown>
  return { start: parseDateValue(range.start), end: parseDateValue(range.end) }
}

export function stringifyToolDateRangeValue(v: ToolDateRangeStored): string {
  const out: ToolDateRangeStored = {}
  if (v.start) out.start = v.start
  if (v.end) out.end = v.end
  if (!out.start && !out.end) return ''
  return JSON.stringify(out)
}
