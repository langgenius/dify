import type {
  EvaluationRunItemResponse as EvaluationRunItem,
  EvaluationMetric as EvaluationRunMetric,
} from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { EvaluationResourceState } from '../../types'
import { formatTime } from '@/utils/time'

const PREFERRED_QUERY_INPUT_KEYS = ['query', 'question', 'input']

export type MetricColumn = {
  id: string
  label: string
}

const normalizeMetricKey = (value: string) => value.toLowerCase().replace(/[\s_-]/g, '')

const humanizeMetricName = (name: string) => {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-'

  if (typeof value === 'string') return value

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false'

  return JSON.stringify(value)
}

export const getQueryContent = (item: EvaluationRunItem) => {
  const inputs = item.inputs ?? {}
  for (const key of PREFERRED_QUERY_INPUT_KEYS) {
    const value = inputs[key]
    if (value !== undefined) return formatValue(value)
  }

  const firstValue = Object.values(inputs).find(
    (value) => value !== undefined && value !== null && value !== '',
  )
  return formatValue(firstValue)
}

export const getMetricValue = (metrics: EvaluationRunMetric[], column: MetricColumn) => {
  const normalizedColumnId = normalizeMetricKey(column.id)
  const normalizedColumnLabel = normalizeMetricKey(column.label)
  const metric = metrics.find((item) => {
    if (!item.name) return false

    const normalizedMetricName = normalizeMetricKey(item.name)
    return (
      normalizedMetricName === normalizedColumnId || normalizedMetricName === normalizedColumnLabel
    )
  })

  return metric?.value
}

const getJudgmentResult = (judgment: Record<string, unknown>) => {
  for (const key of ['passed', 'pass', 'success', 'result']) {
    const value = judgment[key]
    if (typeof value === 'boolean') return value

    if (typeof value === 'string') {
      const normalizedValue = value.toLowerCase()
      if (['passed', 'pass', 'success', 'succeeded', 'true'].includes(normalizedValue)) return true

      if (['failed', 'fail', 'failure', 'false'].includes(normalizedValue)) return false
    }
  }

  return null
}

export const getIsItemPassed = (item: EvaluationRunItem) => {
  if (item.error) return false

  if (Array.isArray(item.judgment?.condition_results) && item.judgment.condition_results.length) {
    const judgmentResult = getJudgmentResult(item.judgment ?? {})
    if (judgmentResult !== null) return judgmentResult
  }

  return item.overall_score == null ? true : item.overall_score > 0
}

export const getMetricColumns = (resource: EvaluationResourceState, items: EvaluationRunItem[]) => {
  const columns = new Map<string, MetricColumn>()

  resource.metrics.forEach((metric) => {
    columns.set(normalizeMetricKey(metric.optionId), {
      id: metric.optionId,
      label: metric.label,
    })
  })

  items.forEach((item) => {
    item.metrics?.forEach((metric) => {
      if (!metric.name) return

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
  if (!timestamp) return '-'

  const milliseconds = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
  return formatTime({ date: milliseconds, dateFormat: 'YYYY-MM-DD HH:mm' })
}
