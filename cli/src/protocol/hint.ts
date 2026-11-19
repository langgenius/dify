import { isRecord } from '@/util/is-record'

export type Hint = {
  summary: string
  op: string
  input?: Record<string, unknown>
  form?: unknown
}

function isHint(value: unknown): value is Hint {
  return isRecord(value) && typeof value.op === 'string' && typeof value.summary === 'string'
}

export function parseHints(value: unknown): Hint[] {
  return Array.isArray(value) ? value.filter(isHint) : []
}
