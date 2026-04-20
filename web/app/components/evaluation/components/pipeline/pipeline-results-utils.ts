import type { EvaluationResourceState } from '../../types'
import type { EvaluationRunItem, EvaluationRunMetric } from '@/types/evaluation'
import { formatTime } from '@/utils/time'

const PREFERRED_QUERY_INPUT_KEYS = ['query', 'question', 'input']

export type MetricColumn = {
  id: string
  label: string
  threshold?: number
}

const normalizeMetricKey = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '')

const humanizeMetricName = (name: string) => {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '')
    return '-'

  if (typeof value === 'string')
    return value

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  }

  if (typeof value === 'boolean')
    return value ? 'true' : 'false'

  return JSON.stringify(value)
}

export const getQueryContent = (item: EvaluationRunItem) => {
  for (const key of PREFERRED_QUERY_INPUT_KEYS) {
    const value = item.inputs[key]
    if (value !== undefined)
      return formatValue(value)
  }

  const firstValue = Object.values(item.inputs).find(value => value !== undefined && value !== null && value !== '')
  return formatValue(firstValue)
}

export const getMetricValue = (metrics: EvaluationRunMetric[], column: MetricColumn) => {
  const normalizedColumnId = normalizeMetricKey(column.id)
  const normalizedColumnLabel = normalizeMetricKey(column.label)
  const metric = metrics.find((item) => {
    if (!item.name)
      return false

    const normalizedMetricName = normalizeMetricKey(item.name)
    return normalizedMetricName === normalizedColumnId || normalizedMetricName === normalizedColumnLabel
  })

  return metric?.value
}

const getNumericMetricValue = (metrics: EvaluationRunMetric[], column: MetricColumn) => {
  const value = getMetricValue(metrics, column)
  if (typeof value === 'number')
    return value

  if (typeof value === 'string' && value.trim() !== '') {
    const numericValue = Number(value)
    return Number.isNaN(numericValue) ? null : numericValue
  }

  return null
}

export const getMetricTextClassName = (value: unknown, column: MetricColumn) => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : null

  if (numericValue === null || Number.isNaN(numericValue))
    return 'text-text-secondary'

  if (column.threshold === undefined)
    return 'text-text-secondary'

  if (numericValue >= column.threshold)
    return 'text-util-colors-green-green-600'

  if (numericValue === 0)
    return 'text-util-colors-red-red-600'

  return 'text-util-colors-warning-warning-600'
}

const getJudgmentResult = (judgment: Record<string, unknown>) => {
  for (const key of ['passed', 'pass', 'success', 'result']) {
    const value = judgment[key]
    if (typeof value === 'boolean')
      return value

    if (typeof value === 'string') {
      const normalizedValue = value.toLowerCase()
      if (['passed', 'pass', 'success', 'succeeded', 'true'].includes(normalizedValue))
        return true

      if (['failed', 'fail', 'failure', 'false'].includes(normalizedValue))
        return false
    }
  }

  return null
}

export const getIsItemPassed = (item: EvaluationRunItem, metricColumns: MetricColumn[]) => {
  if (item.error)
    return false

  const judgmentResult = getJudgmentResult(item.judgment)
  if (judgmentResult !== null)
    return judgmentResult

  const thresholdColumns = metricColumns.filter(column => column.threshold !== undefined)
  if (thresholdColumns.length > 0) {
    return thresholdColumns.every((column) => {
      const metricValue = getNumericMetricValue(item.metrics, column)
      const threshold = column.threshold
      return threshold !== undefined && metricValue !== null && metricValue >= threshold
    })
  }

  return item.overall_score === null ? true : item.overall_score > 0
}

export const getMetricColumns = (
  resource: EvaluationResourceState,
  items: EvaluationRunItem[],
) => {
  const columns = new Map<string, MetricColumn>()

  resource.metrics.forEach((metric) => {
    columns.set(normalizeMetricKey(metric.optionId), {
      id: metric.optionId,
      label: metric.label,
      threshold: metric.threshold,
    })
  })

  items.forEach((item) => {
    item.metrics.forEach((metric) => {
      if (!metric.name)
        return

      const normalizedName = normalizeMetricKey(metric.name)
      if (!columns.has(normalizedName)) {
        columns.set(normalizedName, {
          id: metric.name,
          label: humanizeMetricName(metric.name),
        })
      }
    })
  })

  return Array.from(columns.values())
}

export const getRunDate = (timestamp: number | null) => {
  if (!timestamp)
    return '-'

  const milliseconds = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
  return formatTime({ date: milliseconds, dateFormat: 'YYYY-MM-DD HH:mm' })
}
