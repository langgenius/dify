export type TraceDirection = 'in' | 'out'

export type TraceEntry = {
  seq: number
  ts: string
  dir: TraceDirection
  kind: string
  payload: unknown
  version?: number
  state?: string
}

export type TraceInput = Omit<TraceEntry, 'seq' | 'ts'>

export type TraceSnapshot = {
  entries: TraceEntry[]
  truncated: boolean
}

export type TraceBuffer = {
  append: (input: TraceInput) => void
  snapshot: () => TraceSnapshot
  clear: () => void
}

export const TRACE_BUFFER_CAP = 2000

export const createTraceBuffer = (cap: number = TRACE_BUFFER_CAP): TraceBuffer => {
  let entries: TraceEntry[] = []
  let seq = 0
  let truncated = false
  return {
    append(input) {
      seq += 1
      entries.push({ ...input, seq, ts: new Date().toISOString() })
      if (entries.length > cap) {
        entries.shift()
        truncated = true
      }
    },
    snapshot() {
      return { entries: entries.slice(), truncated }
    },
    clear() {
      entries = []
      seq = 0
      truncated = false
    },
  }
}

export const readTraceVersion = (data: unknown): number | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const value = record.version ?? record.at_version
  return typeof value === 'number' ? value : undefined
}

export const readTraceState = (data: unknown): string | undefined => {
  if (typeof data !== 'object' || data === null) return undefined
  const value = (data as Record<string, unknown>).state
  return typeof value === 'string' ? value : undefined
}
