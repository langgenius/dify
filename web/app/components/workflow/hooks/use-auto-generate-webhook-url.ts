import { produce } from 'immer'
import { useCallback } from 'react'
import { useStore as useAppStore } from '@/app/components/app/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { fetchWebhookUrl } from '@/service/apps'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

export const useAutoGenerateWebhookUrl = () => {
  const collaborativeWorkflow = useCollaborativeWorkflow()

  return useCallback(async (nodeId: string) => {
    const appId = useAppStore.getState().appDetail?.id
    if (!appId)
      return

    const { nodes } = collaborativeWorkflow.getState()
    const node = nodes.find(n => n.id === nodeId)
    if (!node || node.data.type !== BlockEnum.TriggerWebhook)
      return

    if (node.data.webhook_url && node.data.webhook_url.length > 0)
      return

    try {
      const response = await fetchWebhookUrl({ appId, nodeId })
      const { nodes: latestNodes, setNodes } = collaborativeWorkflow.getState()
      let hasUpdated = false
      const updatedNodes = produce(latestNodes, (draft) => {
        const targetNode = draft.find(n => n.id === nodeId)
        if (!targetNode || targetNode.data.type !== BlockEnum.TriggerWebhook)
          return

        targetNode.data = {
          ...targetNode.data,
          webhook_url: response.webhook_url,
          webhook_debug_url: response.webhook_debug_url,
        }
        hasUpdated = true
      })

      if (hasUpdated)
        setNodes(updatedNodes)
    }
    catch (error: unknown) {
      console.error('Failed to auto-generate webhook URL:', error)
    }
  }, [collaborativeWorkflow])
}
