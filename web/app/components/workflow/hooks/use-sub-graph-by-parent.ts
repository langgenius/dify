import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '../types'
import { useMemo } from 'react'
import { useStore as useReactFlowStore } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useIsChatMode } from './use-workflow'
import { useWorkflowVariables } from './use-workflow-variables'

type SubGraphNodesByParentResult = {
  subGraphNodes: Node[]
  subGraphNodeIds: string[]
}

type SubGraphOutputVarsByParentOptions = {
  filterVar?: (payload: Var, selector: ValueSelector) => boolean
}

type SubGraphOutputVarsByParentResult = SubGraphNodesByParentResult & {
  subGraphOutputVars: NodeOutPutVar[]
}

const defaultFilterVar = () => true

export const useSubGraphNodesByParent = (parentNodeId?: string): SubGraphNodesByParentResult => {
  const nodes = useReactFlowStore(useShallow(state => state.getNodes()))

  return useMemo(() => {
    if (!parentNodeId)
      return { subGraphNodes: [], subGraphNodeIds: [] }

    const subGraphNodes = nodes.filter((node) => {
      const parentId = node.data.parent_node_id
      if (parentId === parentNodeId)
        return true
      // Reason: fallback for legacy nested nodes missing parent_node_id.
      if (!parentId && node.id.startsWith(`${parentNodeId}_ext_`))
        return true
      return false
    })

    return {
      subGraphNodes,
      subGraphNodeIds: subGraphNodes.map(node => node.id),
    }
  }, [nodes, parentNodeId])
}

export const useSubGraphOutputVarsByParent = (
  parentNodeId?: string,
  options?: SubGraphOutputVarsByParentOptions,
): SubGraphOutputVarsByParentResult => {
  const { subGraphNodes, subGraphNodeIds } = useSubGraphNodesByParent(parentNodeId)
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const filterVar = options?.filterVar ?? defaultFilterVar

  const subGraphOutputVars = useMemo(() => {
    if (!subGraphNodes.length)
      return []

    const vars = getNodeAvailableVars({
      beforeNodes: subGraphNodes,
      isChatMode,
      filterVar,
    })
    const nodeIdSet = new Set(subGraphNodeIds)
    return vars.filter(item => nodeIdSet.has(item.nodeId))
  }, [filterVar, getNodeAvailableVars, isChatMode, subGraphNodeIds, subGraphNodes])

  return {
    subGraphNodes,
    subGraphNodeIds,
    subGraphOutputVars,
  }
}
