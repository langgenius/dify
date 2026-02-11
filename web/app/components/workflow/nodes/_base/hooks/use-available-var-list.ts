import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useFeatures } from '@/app/components/base/features/hooks'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { inputVarTypeToVarType } from '../../data-source/utils'
import useNodeInfo from './use-node-info'

type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

// TODO: loop type?
const useAvailableVarList = (nodeId: string, {
  onlyLeafNodeVar,
  filterVar,
  hideEnv,
  hideChatVar,
  passedInAvailableNodes,
}: Params = {
  onlyLeafNodeVar: false,
  filterVar: () => true,
}) => {
  const { getTreeLeafNodes, getNodeById, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const features = useFeatures(s => s.features)
  const isSupportSandbox = !!features.sandbox?.enabled
  const baseAvailableNodes = useMemo(() => {
    return passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
  }, [passedInAvailableNodes, onlyLeafNodeVar, nodeId, getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent])
  const parentAvailableNodes = useWorkflowStore(useShallow(s => s.parentAvailableNodes)) || []
  const availableNodes = useMemo(() => {
    if (!parentAvailableNodes.length)
      return baseAvailableNodes
    const merged = new Map<string, Node>()
    baseAvailableNodes.forEach((node) => {
      merged.set(node.id, node)
    })
    parentAvailableNodes.forEach((node) => {
      if (!merged.has(node.id))
        merged.set(node.id, node)
    })
    return Array.from(merged.values())
  }, [baseAvailableNodes, parentAvailableNodes])
  const {
    parentNode: iterationNode,
  } = useNodeInfo(nodeId)

  const currNode = getNodeById(nodeId)
  const ragPipelineVariables = useWorkflowStore(s => s.ragPipelineVariables)
  const isDataSourceNode = currNode?.data?.type === BlockEnum.DataSource
  const dataSourceRagVars: NodeOutPutVar[] = []
  if (isDataSourceNode) {
    const ragVariablesInDataSource = ragPipelineVariables?.filter(ragVariable => ragVariable.belong_to_node_id === nodeId)
    const filterVars = ragVariablesInDataSource?.filter(v => filterVar({
      variable: v.variable,
      type: inputVarTypeToVarType(v.type),
      nodeId,
      isRagVariable: true,
    }, ['rag', nodeId, v.variable]))
    if (filterVars?.length) {
      dataSourceRagVars.push({
        nodeId,
        title: currNode.data?.title,
        vars: filterVars.map((v) => {
          return {
            variable: `rag.${nodeId}.${v.variable}`,
            type: inputVarTypeToVarType(v.type),
            description: v.label,
            isRagVariable: true,
          } as Var
        }),
      })
    }
  }
  const availableVars = [...getNodeAvailableVars({
    parentNode: iterationNode,
    beforeNodes: availableNodes,
    isChatMode,
    filterVar,
    hideEnv,
    hideChatVar,
  }), ...dataSourceRagVars]
  const availableNodesWithParent = useMemo(() => {
    return [
      ...availableNodes,
      ...(isDataSourceNode ? [currNode] : []),
    ]
  }, [availableNodes, currNode, isDataSourceNode])
  const llmNodeIds = new Set(
    availableNodesWithParent
      .filter(node => node?.data.type === BlockEnum.LLM)
      .map(node => node!.id),
  )
  const filteredAvailableVars = llmNodeIds.size
    ? availableVars
        .map((nodeVar) => {
          if (!llmNodeIds.has(nodeVar.nodeId))
            return nodeVar
          const nextVars = nodeVar.vars.filter(item => item.variable !== 'context').filter((item) => {
            if (isSupportSandbox && item.type === VarType.string)
              return item.variable !== 'text' && item.variable !== 'reasoning_content'

            return true
          })
          return {
            ...nodeVar,
            vars: nextVars,
          }
        })
        .filter(nodeVar => nodeVar.vars.length > 0)
    : availableVars

  return {
    availableVars: filteredAvailableVars,
    availableNodes,
    availableNodesWithParent,
  }
}

export default useAvailableVarList
