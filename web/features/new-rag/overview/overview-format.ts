export const OVERVIEW_REFRESH_INTERVAL = 2000

export type MetricChange = {
  direction: 'decrease' | 'increase' | 'neutral'
  label: string
}

export function compactNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale).format(value)
}

export function formatDuration(seconds: number | null | undefined, locale: string) {
  if (seconds === null || seconds === undefined) return '—'
  const [value, unit]: [number, Intl.NumberFormatOptions['unit']] =
    seconds < 60
      ? [Math.max(1, Math.round(seconds)), 'second']
      : seconds < 3600
        ? [Math.round(seconds / 60), 'minute']
        : seconds < 86400
          ? [Math.round(seconds / 3600), 'hour']
          : [Math.round(seconds / 86400), 'day']
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value)
}

export function formatMetricChange(
  value: number | null,
  locale: string,
  suffix: '%' | 'pp' = '%',
): MetricChange {
  const direction = value === null || value === 0 ? 'neutral' : value > 0 ? 'increase' : 'decrease'
  if (value === null || value === 0) return { direction, label: '—' }

  const label =
    suffix === '%'
      ? new Intl.NumberFormat(locale, {
          maximumFractionDigits: 0,
          signDisplay: 'exceptZero',
          style: 'percent',
        }).format(value / 100)
      : `${new Intl.NumberFormat(locale, {
          maximumFractionDigits: 0,
          signDisplay: 'exceptZero',
        }).format(value)} ${suffix}`

  return { direction, label }
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
