import type { BlockDefaultValue } from '../block-selector/types'
import type { CommonNodeType, Node } from '../types'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from 'reactflow'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { editorCollaborationEnabledAtom } from '../editor-resource/state'
import { BlockEnum } from '../types'
import { useAutoGenerateWebhookUrl } from './use-auto-generate-webhook-url'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'

export function getStartNodeData(
  type: BlockEnum,
  defaults: Partial<CommonNodeType> & { config?: Record<string, unknown> },
  selection?: BlockDefaultValue,
) {
  const base = { title: '', desc: '', ...defaults }
  if (type !== BlockEnum.TriggerPlugin || !selection || !('event_name' in selection))
    return { ...base, ...selection, type }
  return {
    ...base,
    type,
    plugin_id: selection.plugin_id,
    provider_id: selection.provider_name,
    provider_type: selection.provider_type,
    provider_name: selection.provider_name,
    event_name: selection.event_name,
    event_label: selection.event_label,
    event_description: selection.event_description,
    title: selection.event_label || selection.title || base.title,
    desc: selection.event_description || base.desc,
    output_schema: { ...selection.output_schema },
    parameters_schema: selection.paramSchemas ? [...selection.paramSchemas] : [],
    config: { ...defaults.config, ...selection.params },
    subscription_id: selection.subscription_id,
    plugin_unique_identifier: selection.plugin_unique_identifier,
    is_team_authorization: selection.is_team_authorization,
    meta: selection.meta ? { ...selection.meta } : undefined,
  }
}

export function useSelectStartNode() {
  const enabled = useAtomValue(editorCollaborationEnabledAtom)
  const flow = useStoreApi()
  const collaborative = useCollaborativeWorkflow()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const generateWebhook = useAutoGenerateWebhookUrl()
  const subscriptionRef = useRef<() => void>(undefined)
  useEffect(() => () => subscriptionRef.current?.(), [])

  return useCallback(
    (makeNode: (nodes: Node[]) => Node | undefined, selected: () => void, replaceAll = false) => {
      subscriptionRef.current?.()
      const apply = () => {
        const state = flow.getState()
        const nodes = state.getNodes()
        const chosen = makeNode(nodes)
        if (!chosen) return
        const placeholder =
          enabled && replaceAll
            ? nodes.find((node) => node.data.type === BlockEnum.StartPlaceholder)
            : undefined
        const next = placeholder
          ? { ...chosen, id: placeholder.id, position: placeholder.position }
          : chosen
        if (!enabled && replaceAll) {
          state.setNodes([next])
          state.setEdges([])
        } else {
          const updated = nodes
            .map((node) =>
              node.id === next.id ? next : { ...node, data: { ...node.data, selected: false } },
            )
            .filter((node) => node.data.type !== BlockEnum.StartPlaceholder)
          if (!updated.includes(next)) updated.push(next)
          if (enabled) collaborative.setNodes(updated)
          else state.setNodes(updated)
        }
        selected()
        handleSyncWorkflowDraft(true, false, { onSuccess: () => generateWebhook(next.id) })
      }
      if (!enabled || collaborationManager.canPersistLocalGraph()) apply()
      else
        subscriptionRef.current = collaborationManager.onGraphReadyChange((ready) => {
          if (!ready) return
          subscriptionRef.current?.()
          apply()
        })
    },
    [enabled, flow, collaborative, handleSyncWorkflowDraft, generateWebhook],
  )
}
