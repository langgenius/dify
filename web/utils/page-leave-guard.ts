type PageLeaveGuard = {
  message: string
  shouldBlock: () => boolean
}

const guards = new Map<PageLeaveGuard, () => void>()

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
