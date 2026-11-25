import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'
import { useNodeDataUpdate } from './use-node-data-update'

export const useAutoGenerateWebhookUrl = () => {
  const appId = useAtomValue(editorAppIdAtom)
  const queryClient = useQueryClient()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { initializeNodeData } = useNodeDataUpdate()

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
        const current = collaborativeWorkflow.getState().nodes.find((n) => n.id === nodeId)
        if (current?.data.type !== BlockEnum.TriggerWebhook || current.data.webhook_url) return
        initializeNodeData({
          id: nodeId,
          previousData: node.data,
          data: {
            webhook_url: response.webhook_url,
            webhook_debug_url: response.webhook_debug_url,
          },
        })
      } catch (error: unknown) {
        console.error('Failed to auto-generate webhook URL:', error)
      }
    },
    [appId, collaborativeWorkflow, initializeNodeData, queryClient],
  )
}
