import type { SessionView } from '../types'
import type { TraceEntry, TraceSnapshot } from './trace-buffer'

export type TraceExport = {
  meta: {
    session_id: string
    app_id: string
    entry_mode: string
    state: string
    version: number
    model: SessionView['model']
    captured_at: string
    entry_count: number
    truncated: boolean
  }
  trace: TraceEntry[]
}

export const buildTraceExport = (snapshot: TraceSnapshot, view: SessionView | null): TraceExport => ({
  meta: {
    session_id: view?.session_id ?? '',
    app_id: view?.app_id ?? '',
    entry_mode: view?.entry_mode ?? '',
    state: view?.state ?? '',
    version: view?.version ?? 0,
    model: view?.model ?? null,
    captured_at: new Date().toISOString(),
    entry_count: snapshot.entries.length,
    truncated: snapshot.truncated,
  },
  trace: snapshot.entries,
})

export const serializeTraceExport = (data: TraceExport): string => {
  const seen = new WeakSet<object>()
  return JSON.stringify(
    data,
    (_key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'function') return `[Function ${(value as { name?: string }).name || 'anonymous'}]`
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    },
    2,
  )
}
