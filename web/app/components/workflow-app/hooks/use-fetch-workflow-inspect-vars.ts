import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { useWorkflowStore } from '../../workflow/store'
import { useStoreApi } from 'reactflow'
import type { Node } from '@/app/components/workflow/types'
import { fetchAllInspectVars } from '@/service/workflow'

const useSetWorkflowVarsWithValue = () => {
  const workflowStore = useWorkflowStore()
  const { setNodesWithInspectVars, appId } = workflowStore.getState()
  const store = useStoreApi()

  const addNodeInfo = (inspectVars: VarInInspect[]) => {
    const { getNodes } = store.getState()
    const nodeArr = getNodes()
    const nodesKeyValue: Record<string, Node> = {}
    // TODO: handle conversation, env and system variables
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
        nodeType: node.data.type,
        title: node.data.title,
        vars: varsUnderTheNode,
      }
      return nodeWithVar
    })
    setNodesWithInspectVars(res)
  }

  const fetchInspectVars = async () => {
    const data = await fetchAllInspectVars(appId)
    addNodeInfo(data)
  }
  return {
    fetchInspectVars,
  }
}

export default useSetWorkflowVarsWithValue
