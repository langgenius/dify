export const OVERVIEW_REFRESH_INTERVAL = 2000

export function compactNumber(value: number) {
  return Intl.NumberFormat().format(value)
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

export function changeLabel(value: number | null, suffix = '%') {
  if (value === null || value === 0) return '—'
  return `${value > 0 ? '+' : ''}${Math.round(value)}${suffix}`
}

export function overviewRefreshInterval({
  generatedAt,
  hasActiveTasks,
  latestTaskUpdatedAt,
}: {
  generatedAt?: string
  hasActiveTasks: boolean
  latestTaskUpdatedAt?: number
}) {
  if (hasActiveTasks) return OVERVIEW_REFRESH_INTERVAL
  if (latestTaskUpdatedAt === undefined) return false
  const generatedAtTimestamp = generatedAt ? Date.parse(generatedAt) : Number.NaN
  return Number.isFinite(generatedAtTimestamp) && generatedAtTimestamp >= latestTaskUpdatedAt
    ? false
    : OVERVIEW_REFRESH_INTERVAL
}
