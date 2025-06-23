import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { useWorkflowStore } from '../../workflow/store'
import { useStoreApi } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { fetchAllInspectVars } from '@/service/workflow'
import { useInvalidateConversationVarValues, useInvalidateSysVarValues } from '@/service/use-workflow'
import { useNodesInteractionsWithoutSync } from '../../workflow/hooks/use-nodes-interactions-without-sync'
const useSetWorkflowVarsWithValue = () => {
  const workflowStore = useWorkflowStore()
  const { setNodesWithInspectVars, appId } = workflowStore.getState()
  const store = useStoreApi()
  const invalidateConversationVarValues = useInvalidateConversationVarValues(appId)
  const invalidateSysVarValues = useInvalidateSysVarValues(appId)
  const { handleCancelAllNodeSuccessStatus } = useNodesInteractionsWithoutSync()

  const setInspectVarsToStore = (inspectVars: VarInInspect[]) => {
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
  }

  const fetchInspectVars = async () => {
    invalidateConversationVarValues()
    invalidateSysVarValues()
    const data = await fetchAllInspectVars(appId)
    setInspectVarsToStore(data)
    handleCancelAllNodeSuccessStatus() // to make sure clear node output show the unset status
  }
  return {
    fetchInspectVars,
  }
}

export default useSetWorkflowVarsWithValue
