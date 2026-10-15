import { useQueryClient } from '@tanstack/react-query'
import { produce } from 'immer'
import { useCallback } from 'react'
import { BlockEnum } from '@/app/components/workflow/types'
import { useParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

export const useAutoGenerateWebhookUrl = () => {
  const { appId } = useParams<{ appId?: string }>()
  const queryClient = useQueryClient()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  return useCallback(
    async (nodeId: string) => {
      if (!appId) return

      const { nodes } = collaborativeWorkflow.getState()
      const node = nodes.find((n) => n.id === nodeId)
      if (!node || node.data.type !== BlockEnum.TriggerWebhook) return

      if (node.data.webhook_url && node.data.webhook_url.length > 0) return

      try {
        const response = await queryClient.query(
          consoleQuery.apps.byAppId.workflows.triggers.webhook.get.queryOptions({
            input: { params: { app_id: appId }, query: { node_id: nodeId } },
            staleTime: 0,
            retry: false,
          }),
        )
        const { nodes: latestNodes, setNodes } = collaborativeWorkflow.getState()
        let hasUpdated = false
        const updatedNodes = produce(latestNodes, (draft) => {
          const targetNode = draft.find((n) => n.id === nodeId)
          if (!targetNode || targetNode.data.type !== BlockEnum.TriggerWebhook) return

          targetNode.data = {
            ...targetNode.data,
            webhook_url: response.webhook_url,
            webhook_debug_url: response.webhook_debug_url,
          }
          hasUpdated = true
        })

        if (hasUpdated) setNodes(updatedNodes)
      } catch (error: unknown) {
        console.error('Failed to auto-generate webhook URL:', error)
      }
    },
    [appId, collaborativeWorkflow, queryClient],
  )
}
