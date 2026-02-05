import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import { load as yamlLoad } from 'js-yaml'

type GraphPayload = {
  nodes?: Node[]
  edges?: Edge[]
  viewport?: Viewport
}

type DslPayload = {
  workflow?: {
    graph?: GraphPayload
  }
  graph?: GraphPayload
} | null

export type ParsedGraph = {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
} | null

export const parseGraphFromDsl = (dslContent: string): ParsedGraph => {
  if (!dslContent)
    return null

  try {
    const data = yamlLoad(dslContent) as DslPayload
    const graph = data?.workflow?.graph ?? data?.graph
    if (!graph || !graph.nodes || !graph.edges)
      return null

    return {
      nodes: graph.nodes || [],
      edges: graph.edges || [],
      viewport: graph.viewport || { x: 0, y: 0, zoom: 0.5 },
    }
  }
  catch {
    return null
  }
}

type UsedCountFormatOptions = {
  precision?: number
  rounding?: 'round' | 'floor'
}

export const formatUsedCount = (count?: number, options: UsedCountFormatOptions = {}) => {
  if (!count)
    return null
  if (count < 1000)
    return String(count)

  const precision = options.precision ?? 1
  const rounding = options.rounding ?? 'round'
  const base = count / 1000
  const factor = 10 ** precision
  const rounded = rounding === 'floor'
    ? Math.floor(base * factor) / factor
    : Math.round(base * factor) / factor

  const display = precision <= 0
    ? String(rounded)
    : (rounded % 1 === 0 ? String(rounded) : rounded.toFixed(precision))

  return `${display}k`
}

type TranslationFn = (key: string, options?: Record<string, unknown>) => string

export const formatRelativeTime = (dateStr: string, t: TranslationFn) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 1)
    return t('detail.today')
  if (diffDays < 7)
    return t('detail.daysAgo', { count: diffDays })
  if (diffDays < 30)
    return t('detail.weeksAgo', { count: Math.floor(diffDays / 7) })
  if (diffDays < 365)
    return t('detail.monthsAgo', { count: Math.floor(diffDays / 30) })
  return t('detail.yearsAgo', { count: Math.floor(diffDays / 365) })
}
