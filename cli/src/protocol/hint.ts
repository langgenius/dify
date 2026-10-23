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

// An input that is not a JSON object is dropped: the hint stays, as the bare command.
function normalized(hint: Hint): Hint {
  if (hint.input === undefined || isRecord(hint.input)) return hint
  const { input: _dropped, ...rest } = hint
  return rest
}

export function parseHints(value: unknown): Hint[] {
  return Array.isArray(value) ? value.filter(isHint).map(normalized) : []
}
