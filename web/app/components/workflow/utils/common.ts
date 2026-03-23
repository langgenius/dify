export const isMac = () => {
  return navigator.userAgent.toUpperCase().includes('MAC')
}

const specialKeysNameMap: Record<string, string | undefined> = {
  ctrl: '⌘',
  alt: '⌥',
  shift: '⇧',
}

export const getKeyboardKeyNameBySystem = (key: string) => {
  if (isMac())
    return specialKeysNameMap[key] || key

  return key
}

const specialKeysCodeMap: Record<string, string | undefined> = {
  ctrl: 'meta',
}

export const getKeyboardKeyCodeBySystem = (key: string) => {
  if (isMac())
    return specialKeysCodeMap[key] || key

  return key
}

export const isEventTargetInputArea = (target: HTMLElement) => {
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
    return true

  if (target.contentEditable === 'true')
    return true
}

/**
 * Format workflow run identifier using finished_at timestamp
 * @param finishedAt - Unix timestamp in seconds
 * @param fallbackText - Text to show when finishedAt is not available (default: 'Running')
 * @returns Formatted string like " (14:30:25)" or " (Running)"
 */
export const formatWorkflowRunIdentifier = (finishedAt?: number, fallbackText = 'Running'): string => {
  if (!finishedAt)
    return ` (${fallbackText})`

  const date = new Date(finishedAt * 1000)
  const timeStr = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return ` (${timeStr})`
}
