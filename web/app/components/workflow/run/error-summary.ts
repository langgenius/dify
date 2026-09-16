const DEFAULT_MAX_LENGTH = 180

/**
 * Collapse long multi-line runtime errors into a short first-line summary
 * so the run panel stays scannable. Full text remains available via title/copy.
 */
export const summarizeWorkflowError = (
  error: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH,
): string => {
  if (!error) return ''

  const normalized = error.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''

  const firstLine = (normalized.split('\n').find((line) => line.trim()) ?? normalized).trim()

  if (normalized.length <= maxLength && firstLine === normalized) return normalized

  if (firstLine.length <= maxLength) return firstLine

  return `${firstLine.slice(0, maxLength - 1)}…`
}
