import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { BlockEnum, type Node, type NodeOutPutVar, type ValueSelector, type Var } from '@/app/components/workflow/types'
type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

const getNodeInfo = (nodeId: string, nodes: Node[]) => {
  const allNodes = nodes
  const node = allNodes.find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const isInLoop = !!node?.data.isInLoop
  const parentNodeId = node?.parentId
  const parentNode = allNodes.find(n => n.id === parentNodeId)
  return {
    node,
    isInIteration,
    isInLoop,
    parentNode,
  }
}

// TODO: loop type?
const useNodesAvailableVarList = (nodes: Node[], {
  onlyLeafNodeVar,
  filterVar,
  hideEnv = false,
  hideChatVar = false,
  passedInAvailableNodes,
}: Params = {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  }) => {
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()

  const nodeAvailabilityMap: { [key: string ]: { availableVars: NodeOutPutVar[], availableNodes: Node[] } } = {}

  nodes.forEach((node) => {
    const nodeId = node.id
    const availableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
    if (node.data.type === BlockEnum.Loop)
      availableNodes.push(node)

    const {
      parentNode: iterationNode,
    } = getNodeInfo(nodeId, nodes)

    const availableVars = getNodeAvailableVars({
      parentNode: iterationNode,
      beforeNodes: availableNodes,
      isChatMode,
      filterVar,
      hideEnv,
      hideChatVar,
    })
    const result = {
      node,
      availableVars,
      availableNodes,
    }
    nodeAvailabilityMap[nodeId] = result
  })
  return nodeAvailabilityMap
}

export default useNodesAvailableVarList
