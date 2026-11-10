import type { SessionView } from '../types'
import type { TraceEntry, TraceSnapshot } from './trace-buffer'

export type TraceExport = {
  meta: {
    session_id: string
    version: number
    phase: SessionView['phase'] | null
    run_status: SessionView['run_status'] | null
    model: SessionView['model']
    captured_at: string
    entry_count: number
    truncated: boolean
  }
  trace: TraceEntry[]
}

export const buildTraceExport = (
  snapshot: TraceSnapshot,
  view: SessionView | null,
): TraceExport => ({
  meta: {
    session_id: view?.session_id ?? '',
    version: view?.version ?? 0,
    phase: view?.phase ?? null,
    run_status: view?.run_status ?? null,
    model: view?.model ?? null,
    captured_at: new Date().toISOString(),
    entry_count: snapshot.entries.length,
    truncated: snapshot.truncated,
  },
  trace: snapshot.entries,
})

export const serializeTraceExport = (data: TraceExport): string => {
  // Single-WeakSet cycle guard: a shared-but-acyclic sibling reference (the
  // same object appearing twice, not nested within itself) is also flagged
  // as `[Circular]`. Acceptable for a debug export.
  const seen = new WeakSet<object>()
  return JSON.stringify(
    data,
    (_key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'function')
        return `[Function ${(value as { name?: string }).name || 'anonymous'}]`
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    },
    2,
  )
}
