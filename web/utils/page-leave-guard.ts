type PageLeaveGuard = {
  message: string
  shouldBlock: () => boolean
}

// Keep confirmation guards separate from beforeunload listeners that save drafts
// or release locks. Probing them by dispatching beforeunload would run those effects.
const guards = new Map<PageLeaveGuard, () => void>()

export function registerPageLeaveGuard(guard: PageLeaveGuard) {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!guard.shouldBlock()) return
    event.preventDefault()
    event.returnValue = ''
  }
  const unregister = () => {
    window.removeEventListener('beforeunload', handleBeforeUnload)
    guards.delete(guard)
  }
  guards.set(guard, unregister)
  window.addEventListener('beforeunload', handleBeforeUnload)
  return unregister
}

export function confirmPageLeave() {
  const messages = [
    ...new Set(
      [...guards.keys()].filter((guard) => guard.shouldBlock()).map((guard) => guard.message),
    ),
  ]
  // oxlint-disable-next-line eslint/no-alert -- Ask the browser's unsaved-changes confirmation before logout; beforeunload itself runs too late to cancel the server request.
  return messages.length === 0 || window.confirm(messages.join('\n\n'))
}

export function clearPageLeaveGuards() {
  for (const unregister of guards.values()) unregister()
}
