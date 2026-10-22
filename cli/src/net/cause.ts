const MAX_CAUSE_DEPTH = 5

export function networkCause(err: unknown): string | undefined {
  let deepest: Error | undefined
  let current: unknown = err
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break
    current = current.cause
    if (current instanceof Error) deepest = current
  }
  if (deepest === undefined) return undefined
  const { code } = deepest as { code?: unknown }
  if (typeof code === 'string' && !deepest.message.includes(code))
    return `${code}: ${deepest.message}`
  return deepest.message
}
