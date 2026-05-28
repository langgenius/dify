const MAC_PLATFORM_PATTERN = /mac/i

const specialKeysCodeMap: Record<string, string | undefined> = {
  ctrl: 'meta',
}

export const getKeyboardKeyCodeBySystem = (key: string) => {
  if (typeof navigator !== 'undefined' && MAC_PLATFORM_PATTERN.test(navigator.userAgent))
    return specialKeysCodeMap[key] || key

  return key
}

/**
 * Format workflow run identifier using finished_at timestamp
 * @param finishedAt - Unix timestamp in seconds
 * @param fallbackText - Text to show when finishedAt is not available (default: 'Running')
 * @returns Formatted string like " (14:30:25)" or " (Running)"
 */
export const formatWorkflowRunIdentifier = (finishedAt?: number, fallbackText = 'Running'): string => {
  if (!finishedAt) {
    const capitalized = fallbackText.charAt(0).toUpperCase() + fallbackText.slice(1)
    return ` (${capitalized})`
  }

  const date = new Date(finishedAt * 1000)
  const timeStr = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return ` (${timeStr})`
}
