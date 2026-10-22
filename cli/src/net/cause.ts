const MAX_CAUSE_DEPTH = 5
const DETAIL_SEPARATOR = '; '

function ownMessage(err: Error): string {
  if (err instanceof AggregateError) {
    const parts = err.errors.flatMap((e) =>
      e instanceof Error && e.message !== '' ? [e.message] : [],
    )
    if (parts.length > 0) return [...new Set(parts)].join(DETAIL_SEPARATOR)
  }
  return err.message
}

export function networkCause(err: unknown): string | undefined {
  let deepest: Error | undefined
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break
    current = current.cause
    if (current instanceof Error) deepest = current
  }
  if (deepest === undefined) return undefined
  const message = ownMessage(deepest)
  const { code } = deepest as { code?: unknown }
  if (typeof code !== 'string') return message === '' ? undefined : message
  if (message === '') return code
  return message.includes(code) ? message : `${code}: ${message}`
}

export function networkErrorMessage(prefix: string, cause: unknown): string {
  const detail = networkCause(cause)
  return detail === undefined ? prefix : `${prefix}: ${detail}`
}
