import { useCallback } from 'react'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useStoreApi } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { fetchAllInspectVars } from '@/service/workflow'
import { useInvalidateConversationVarValues, useInvalidateSysVarValues } from '@/service/use-workflow'
import { useNodesInteractionsWithoutSync } from '@/app/components/workflow/hooks/use-nodes-interactions-without-sync'
import { useConfigsMap } from './use-configs-map'

export const useSetWorkflowVarsWithValue = () => {
  const workflowStore = useWorkflowStore()
  const store = useStoreApi()
  const { conversationVarsUrl, systemVarsUrl } = useConfigsMap()
  const invalidateConversationVarValues = useInvalidateConversationVarValues(conversationVarsUrl)
  const invalidateSysVarValues = useInvalidateSysVarValues(systemVarsUrl)
  const { handleCancelAllNodeSuccessStatus } = useNodesInteractionsWithoutSync()

  const setInspectVarsToStore = useCallback((inspectVars: VarInInspect[]) => {
    const { setNodesWithInspectVars } = workflowStore.getState()
    const { getNodes } = store.getState()
    const nodeArr = getNodes()
    const nodesKeyValue: Record<string, Node> = {}
    nodeArr.forEach((node) => {
      nodesKeyValue[node.id] = node
    })

    const withValueNodeIds: Record<string, boolean> = {}
    inspectVars.forEach((varItem) => {
      const nodeId = varItem.selector[0]

      const node = nodesKeyValue[nodeId]
      if (!node)
        return
      withValueNodeIds[nodeId] = true
    })
    const withValueNodes = Object.keys(withValueNodeIds).map((nodeId) => {
      return nodesKeyValue[nodeId]
    })

    const res: NodeWithVar[] = withValueNodes.map((node) => {
      const nodeId = node.id
      const varsUnderTheNode = inspectVars.filter((varItem) => {
        return varItem.selector[0] === nodeId
      })
      const nodeWithVar = {
        nodeId,
        nodePayload: node.data,
        nodeType: node.data.type,
        title: node.data.title,
        vars: varsUnderTheNode,
        isSingRunRunning: false,
        isValueFetched: false,
      }
      return nodeWithVar
    })
    setNodesWithInspectVars(res)
  }, [workflowStore, store])

  const fetchInspectVars = useCallback(async () => {
    const { appId } = workflowStore.getState()
    invalidateConversationVarValues()
    invalidateSysVarValues()
    const data = await fetchAllInspectVars(appId)
    setInspectVarsToStore(data)
    handleCancelAllNodeSuccessStatus() // to make sure clear node output show the unset status
  }, [workflowStore, invalidateConversationVarValues, invalidateSysVarValues, setInspectVarsToStore, handleCancelAllNodeSuccessStatus])
  return {
    fetchInspectVars,
  }
}
