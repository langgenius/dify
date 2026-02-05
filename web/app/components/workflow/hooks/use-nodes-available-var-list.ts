import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

const mergeAvailableNodes = (baseNodes: Node[], extraNodes: Node[]) => {
  if (!extraNodes.length)
    return baseNodes
  const merged = new Map<string, Node>()
  baseNodes.forEach((node) => {
    merged.set(node.id, node)
  })
  extraNodes.forEach((node) => {
    if (!merged.has(node.id))
      merged.set(node.id, node)
  })
  return Array.from(merged.values())
}

const resolveAvailabilityNodeId = (node: Node, nodes: Node[]) => {
  const parentNodeId = (node.data as { parent_node_id?: string })?.parent_node_id
  if (parentNodeId && nodes.some(n => n.id === parentNodeId))
    return parentNodeId
  return node.id
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
  const parentAvailableNodes = useStore(useShallow(s => s.parentAvailableNodes)) || []

  const nodeAvailabilityMap: { [key: string ]: { availableVars: NodeOutPutVar[], availableNodes: Node[] } } = {}

  nodes.forEach((node) => {
    const nodeId = node.id
    const availabilityNodeId = resolveAvailabilityNodeId(node, nodes)
    const baseAvailableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(availabilityNodeId) : getBeforeNodesInSameBranchIncludeParent(availabilityNodeId))
    const availableNodes = mergeAvailableNodes(baseAvailableNodes, parentAvailableNodes)
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

export const useGetNodesAvailableVarList = () => {
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const parentAvailableNodes = useStore(useShallow(s => s.parentAvailableNodes)) || []
  const getNodesAvailableVarList = useCallback((nodes: Node[], {
    onlyLeafNodeVar,
    filterVar,
    hideEnv,
    hideChatVar,
    passedInAvailableNodes,
  }: Params = {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  }) => {
    const nodeAvailabilityMap: { [key: string ]: { availableVars: NodeOutPutVar[], availableNodes: Node[] } } = {}

    nodes.forEach((node) => {
      const nodeId = node.id
      const availabilityNodeId = resolveAvailabilityNodeId(node, nodes)
      const baseAvailableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(availabilityNodeId) : getBeforeNodesInSameBranchIncludeParent(availabilityNodeId))
      const availableNodes = mergeAvailableNodes(baseAvailableNodes, parentAvailableNodes)
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
  }, [getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent, getNodeAvailableVars, isChatMode, parentAvailableNodes])
  return {
    getNodesAvailableVarList,
  }
}

export default useNodesAvailableVarList
