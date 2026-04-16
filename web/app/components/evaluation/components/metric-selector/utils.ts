import type { MetricOption } from '../../types'
import type { MetricVisualTone } from './types'
import type { EvaluationTargetType, NodeInfo } from '@/types/evaluation'
import { getDefaultMetricDescription } from '../../default-metric-descriptions'

export const toEvaluationTargetType = (resourceType: 'apps' | 'snippets'): EvaluationTargetType => {
  return resourceType === 'snippets' ? 'snippets' : 'apps'
}

const humanizeMetricId = (metricId: string) => {
  return metricId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const buildMetricOption = (metricId: string): MetricOption => ({
  id: metricId,
  label: humanizeMetricId(metricId),
  description: getDefaultMetricDescription(metricId),
  valueType: 'number',
})

export const getMetricVisual = (metricId: string): { icon: string, tone: MetricVisualTone } => {
  if (['context-precision', 'context-recall'].includes(metricId)) {
    return {
      icon: metricId === 'context-recall' ? 'i-ri-arrow-go-back-line' : 'i-ri-focus-2-line',
      tone: 'green',
    }
  }

  if (metricId === 'faithfulness')
    return { icon: 'i-ri-anchor-line', tone: 'indigo' }

  if (metricId === 'tool-correctness')
    return { icon: 'i-ri-tools-line', tone: 'indigo' }

  if (metricId === 'task-completion')
    return { icon: 'i-ri-task-line', tone: 'indigo' }

  if (metricId === 'argument-correctness')
    return { icon: 'i-ri-scales-3-line', tone: 'indigo' }

  return { icon: 'i-ri-checkbox-circle-line', tone: 'indigo' }
}

export const getNodeVisual = (nodeInfo: NodeInfo): { icon: string, tone: MetricVisualTone } => {
  const normalizedType = nodeInfo.type.toLowerCase()
  const normalizedTitle = nodeInfo.title.toLowerCase()

  if (normalizedType.includes('retriev') || normalizedTitle.includes('retriev') || normalizedTitle.includes('knowledge'))
    return { icon: 'i-ri-book-open-line', tone: 'green' }

  if (normalizedType.includes('agent') || normalizedTitle.includes('agent'))
    return { icon: 'i-ri-user-star-line', tone: 'indigo' }

  return { icon: 'i-ri-ai-generate-2', tone: 'indigo' }
}

export const getToneClasses = (tone: MetricVisualTone) => {
  if (tone === 'green') {
    return {
      soft: 'bg-util-colors-green-green-50 text-util-colors-green-green-500',
      solid: 'bg-util-colors-green-green-500 text-white',
    }
  }

  return {
    soft: 'bg-util-colors-indigo-indigo-50 text-util-colors-indigo-indigo-500',
    solid: 'bg-util-colors-indigo-indigo-500 text-white',
  }
}

export const dedupeNodeInfoList = (nodeInfoList: NodeInfo[]) => {
  return Array.from(new Map(nodeInfoList.map(nodeInfo => [nodeInfo.node_id, nodeInfo])).values())
}
