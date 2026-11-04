/**
 * Format workflow run identifier using finished_at timestamp
 * @param finishedAt - Unix timestamp in seconds
 * @param fallbackText - Text to show when finishedAt is not available (default: 'Running')
 * @returns Formatted string like " (14:30:25)" or " (Running)"
 */
export function formatWorkflowRunIdentifier(finishedAt?: number, fallbackText = 'Running'): string {
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
