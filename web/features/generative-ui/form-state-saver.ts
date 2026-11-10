import isEqual from 'fast-deep-equal'

type PendingSave = {
  state: Record<string, unknown>
  save: () => Promise<void>
  onError: () => void
}

/** One mounted message block owns this queue and every queued save's target. */
export function createFormStateSaver(initialState: Record<string, unknown>) {
  let savedState = initialState
  let pending: PendingSave | undefined
  let active: PendingSave | undefined
  let writing: Promise<boolean> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }

  const drain = async () => {
    while (pending) {
      const next = pending
      pending = undefined
      if (isEqual(next.state, savedState)) continue
      active = next
      try {
        await next.save()
        savedState = next.state
      } catch {
        // Keep the latest draft available for another edit or an explicit submit retry.
        pending ??= next
        next.onError()
        return false
      } finally {
        active = undefined
      }
    }
    return true
  }

  const flush = (): Promise<boolean> => {
    clearTimer()
    if (writing) return writing.then((success) => (success ? flush() : false))
    if (!pending) return Promise.resolve(true)
    writing = drain().finally(() => {
      writing = undefined
    })
    return writing
  }

  return {
    schedule(next: PendingSave) {
      const current = pending?.state ?? active?.state ?? savedState
      if (isEqual(next.state, current) && (timer || writing || !pending)) return
      pending = next
      clearTimer()
      timer = setTimeout(() => {
        void flush()
      }, 250)
    },
    flush,
  }
}
