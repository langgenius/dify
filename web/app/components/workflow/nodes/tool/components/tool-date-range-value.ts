export type ToolDateRangeStored = {
  start?: string
  end?: string
}

export function parseToolDateRangeValue(raw: unknown): ToolDateRangeStored {
  if (raw === null || raw === undefined || raw === '')
    return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    return {
      start: typeof o.start === 'string' && o.start ? o.start : undefined,
      end: typeof o.end === 'string' && o.end ? o.end : undefined,
    }
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed)
      return {}
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        return parseToolDateRangeValue(parsed)
    }
    catch {
      // legacy single-day value from earlier date-picker
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed))
      return { start: trimmed, end: undefined }
  }
  return {}
}

export function stringifyToolDateRangeValue(v: ToolDateRangeStored): string {
  const out: ToolDateRangeStored = {}
  if (v.start)
    out.start = v.start
  if (v.end)
    out.end = v.end
  if (!out.start && !out.end)
    return ''
  return JSON.stringify(out)
}
