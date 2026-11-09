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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Expected outputs are keyed by the node they check, such as `{"LLM": "..."}`. Show the value
 * itself, and label each one only when a row checks several nodes.
 */
const parseJsonObject = (value: string) => {
  if (!value.trimStart().startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const formatExpectedOutput = (value: unknown) => {
  // The API may send the keyed object itself or its JSON text.
  const keyedValue = typeof value === 'string' ? (parseJsonObject(value) ?? value) : value
  if (!isPlainObject(keyedValue)) return formatValue(keyedValue)

  const entries = Object.entries(keyedValue)
  if (entries.length === 1) return formatValue(entries[0]![1])

  return entries.map(([key, entryValue]) => `${key}: ${formatValue(entryValue)}`).join('\n')
}

/** A plain-text preview of Markdown for clamped table cells; the full value renders Markdown. */
export const toPlainTextPreview = (markdown: string) => {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*/g, ''))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
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

// Columns come from the run's own results: metrics added to the config after the run would
// otherwise show as columns of empty cells. The config only supplies friendlier labels.
export const getMetricColumns = (resource: EvaluationResourceState, items: EvaluationRunItem[]) => {
  const configLabels = new Map(
    resource.metrics.map((metric) => [normalizeMetricKey(metric.optionId), metric.label] as const),
  )
  const columns = new Map<string, MetricColumn>()

  items.forEach((item) => {
    item.metrics?.forEach((metric) => {
      if (!metric.name) return

      const normalizedName = normalizeMetricKey(metric.name)
      if (!columns.has(normalizedName)) {
        columns.set(normalizedName, {
          id: metric.name,
          label: configLabels.get(normalizedName) ?? humanizeMetricName(metric.name),
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
