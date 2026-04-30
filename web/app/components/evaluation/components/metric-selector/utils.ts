import type { ConditionMetricValueType, MetricOption } from '../../types'
import type { MetricVisualTone } from './types'
import type { EvaluationDefaultMetric, NodeInfo } from '@/types/evaluation'
import { BlockEnum } from '@/app/components/workflow/types'
import { getDefaultMetricDescription } from '../../default-metric-descriptions'

const defaultConditionMetricValueType: ConditionMetricValueType = 'number'

export const normalizeMetricValueType = (valueType: string | undefined): ConditionMetricValueType => {
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
    return valueType

  return defaultConditionMetricValueType
}

const humanizeMetricId = (metricId: string) => {
  return metricId
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export const buildMetricOption = (metricId: string, valueType?: string): MetricOption => ({
  id: metricId,
  label: humanizeMetricId(metricId),
  description: getDefaultMetricDescription(metricId),
  valueType: normalizeMetricValueType(valueType),
})

export const dedupeNodeInfoList = (nodeInfoList: NodeInfo[]) => {
  return Array.from(new Map(nodeInfoList.map(nodeInfo => [nodeInfo.node_id, nodeInfo])).values())
}

export const getDefaultMetricNodeInfoMap = (defaultMetrics: EvaluationDefaultMetric[]) => {
  const nodeInfoMap: Record<string, NodeInfo[]> = {}

  defaultMetrics.forEach((defaultMetric) => {
    if (!defaultMetric.metric)
      return

    nodeInfoMap[defaultMetric.metric] = dedupeNodeInfoList([
      ...(nodeInfoMap[defaultMetric.metric] ?? []),
      ...(defaultMetric.node_info_list ?? []),
    ])
  })

  return nodeInfoMap
}

export const getMetricVisual = (metricId: string): { icon: string, tone: MetricVisualTone } => {
  if (['context_precision', 'context_recall'].includes(metricId)) {
    return {
      icon: metricId === 'context_recall' ? 'i-ri-arrow-go-back-line' : 'i-ri-focus-2-line',
      tone: 'green',
    }
  }

  if (metricId === 'faithfulness')
    return { icon: 'i-ri-anchor-line', tone: 'indigo' }

  if (metricId === 'tool_correctness')
    return { icon: 'i-ri-tools-line', tone: 'indigo' }

  if (metricId === 'task_completion')
    return { icon: 'i-ri-task-line', tone: 'indigo' }

  if (metricId === 'argument_correctness')
    return { icon: 'i-ri-scales-3-line', tone: 'indigo' }

  return { icon: 'i-ri-checkbox-circle-line', tone: 'indigo' }
}

const workflowBlockTypeSet = new Set<string>(Object.values(BlockEnum))

export const getEvaluationNodeBlockType = (nodeInfo: Pick<NodeInfo, 'type'>): BlockEnum => {
  if (workflowBlockTypeSet.has(nodeInfo.type))
    return nodeInfo.type as BlockEnum

  return BlockEnum.LLM
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
