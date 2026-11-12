import type { ExternalAgentAssetResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { consoleClient, consoleQuery } from '@/service/console'
import { asRecord } from '../model'
import { isExternalAgentWorkflowBinding, isExternalAgentWorkflowPreviewData } from './types'

export function useExternalAgentBinding(nodeId: string) {
  const resource = useAtomValue(editorResourceAtom)
  const workflowStore = useWorkflowStore()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const [isChanging, setIsChanging] = useState(false)
  const [hasError, setHasError] = useState(false)
  const rebind = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.externalAgentBindings.byNodeId.rebind.post.mutationOptions(
      { context: { silent: true } },
    ),
  )

  const changeAgent = async (agent: ExternalAgentAssetResponse) => {
    if (resource.kind !== 'app' || isChanging) return false
    setIsChanging(true)
    setHasError(false)
    // Cancel the pending debounce; the awaited save includes every current author edit.
    workflowStore.getState().debouncedSyncWorkflowDraft.cancel?.()
    try {
      const saved = await doSyncWorkflowDraft(true)
      if (!saved?.hash) throw new Error('Draft save did not complete')
      const rebound = await rebind.mutateAsync({
        params: { app_id: resource.appId, node_id: nodeId },
        body: { target_agent_id: agent.id, expected_hash: saved.hash, include_matching: true },
      })
      const draft = await consoleClient.apps.byAppId.workflows.draft.get(
        {
          params: { app_id: resource.appId },
        },
        { context: { silent: true } },
      )
      if (!Array.isArray(draft.graph.nodes)) throw new TypeError('Draft graph is unavailable')
      const bindings = new Map(
        draft.graph.nodes.map((value) => {
          const node = asRecord(value)
          return [node.id, asRecord(node.data).agent_binding]
        }),
      )
      const current = collaborativeWorkflow.getState()
      const nodes = current.nodes.map((node) => {
        if (!rebound.node_ids.includes(node.id) || !isExternalAgentWorkflowPreviewData(node.data))
          return node
        const binding = bindings.get(node.id)
        if (!isExternalAgentWorkflowBinding(binding)) return node
        const identityChanged =
          node.data.agent_binding?.agent_id !== binding.agent_id ||
          node.data.agent_binding?.binding_epoch !== binding.binding_epoch
        return {
          ...node,
          data: {
            ...node.data,
            agent_binding: binding,
            ...(identityChanged
              ? { _singleRunningStatus: undefined, _isSingleRun: undefined }
              : {}),
          },
        }
      })
      // Rebind changes server-owned identity only; preserve author edits made during I/O.
      current.setNodes(nodes)
      workflowStore.getState().setSyncWorkflowDraftHash(draft.hash, { nodes, edges: current.edges })
      return true
    } catch {
      setHasError(true)
      return false
    } finally {
      setIsChanging(false)
    }
  }
  return { changeAgent, isChanging, hasError }
}
