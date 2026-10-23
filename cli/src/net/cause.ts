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

function errorCode(err: Error): string | undefined {
  const { code } = err as { code?: unknown }
  return typeof code === 'string' ? code : undefined
}

// Node wraps the socket error as TypeError('fetch failed', { cause }); Bun throws it bare.
function originOf(err: unknown): Error | undefined {
  if (!(err instanceof Error)) return undefined
  if (!(err.cause instanceof Error)) return errorCode(err) === undefined ? undefined : err
  let deepest: Error = err.cause
  for (let depth = 1; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(deepest.cause instanceof Error)) break
    deepest = deepest.cause
  }
  return deepest
}

export function networkCause(err: unknown): string | undefined {
  const origin = originOf(err)
  if (origin === undefined) return undefined
  const message = ownMessage(origin)
  const code = errorCode(origin)
  if (code === undefined) return message === '' ? undefined : message
  if (message === '') return code
  return message.includes(code) ? message : `${code}: ${message}`
}

export function networkErrorMessage(prefix: string, cause: unknown): string {
  const detail = networkCause(cause)
  return detail === undefined ? prefix : `${prefix}: ${detail}`
}
