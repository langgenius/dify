import { BlockEnum } from '@/app/components/workflow/types'
import type { Node } from '@/app/components/workflow/types'
import type { FetchWorkflowDraftResponse } from '@/types/workflow'

export type TriggerPluginNodePayload = {
  title: string
  desc?: string
  plugin_id: string
  provider_id: string
  event_name: string
  subscription_id: string
  plugin_unique_identifier: string
  event_parameters: Record<string, unknown>
}

export type WorkflowDraftSyncParams = Pick<
  FetchWorkflowDraftResponse,
  'graph' | 'features' | 'environment_variables' | 'conversation_variables'
>

const sanitizeTriggerPluginNode = (node: Node<TriggerPluginNodePayload>): Node<TriggerPluginNodePayload> => {
  const data = node.data

  if (!data || data.type !== BlockEnum.TriggerPlugin)
    return node

  const sanitizedData: TriggerPluginNodePayload & { type: BlockEnum.TriggerPlugin } = {
    type: BlockEnum.TriggerPlugin,
    title: data.title ?? '',
    desc: data.desc,
    plugin_id: data.plugin_id ?? '',
    provider_id: data.provider_id ?? '',
    event_name: data.event_name ?? '',
    subscription_id: data.subscription_id ?? '',
    plugin_unique_identifier: data.plugin_unique_identifier ?? '',
    event_parameters: (typeof data.event_parameters === 'object' && data.event_parameters !== null)
      ? data.event_parameters as Record<string, unknown>
      : {},
  }

  return {
    ...node,
    data: sanitizedData,
  }
}

export const sanitizeWorkflowDraftPayload = (params: WorkflowDraftSyncParams): WorkflowDraftSyncParams => {
  const { graph } = params

  if (!graph?.nodes?.length)
    return params

  const sanitizedNodes = graph.nodes.map(node => sanitizeTriggerPluginNode(node as Node<TriggerPluginNodePayload>))

  return {
    ...params,
    graph: {
      ...graph,
      nodes: sanitizedNodes,
    },
  }
}
