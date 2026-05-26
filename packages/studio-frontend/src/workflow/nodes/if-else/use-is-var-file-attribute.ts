import type { ValueSelector } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import { useIsChatMode, useWorkflow, useWorkflowVariables } from '@/app/components/workflow/hooks/index'
import { VarType } from '@/app/components/workflow/types'

type Params = {
  nodeId: string
  isInIteration: boolean
  isInLoop: boolean
}
const useIsVarFileAttribute = ({
  nodeId,
  isInIteration,
  isInLoop,
}: Params) => {
  const isChatMode = useIsChatMode()
  const store = useStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === nodeId)
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const loopNode = isInLoop ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(nodeId)
  }, [getBeforeNodesInSameBranch, nodeId])
  const { getCurrentVariableType } = useWorkflowVariables()
  const getIsVarFileAttribute = (variable: ValueSelector) => {
    if (variable.length !== 3)
      return false
    const parentVariable = variable.slice(0, 2)
    const varType = getCurrentVariableType({
      parentNode: isInIteration ? iterationNode : loopNode,
      valueSelector: parentVariable,
      availableNodes,
      isChatMode,
      isConstant: false,
    })
    return varType === VarType.file
  }
  return {
    getIsVarFileAttribute,
  }
}

export default useIsVarFileAttribute
