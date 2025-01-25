import { useStoreApi } from 'reactflow'
import { useMemo } from 'react'
import { useIsChatMode, useWorkflow, useWorkflowVariables } from '../../hooks'
import type { ValueSelector } from '../../types'
import { VarType } from '../../types'

type Params = {
  nodeId: string
  isInIteration: boolean
}
const useIsVarFileAttribute = ({
  nodeId,
  isInIteration,
}: Params) => {
  const isChatMode = useIsChatMode()
  const store = useStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === nodeId)
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(nodeId)
  }, [getBeforeNodesInSameBranch, nodeId])
  const { getCurrentVariableType } = useWorkflowVariables()
  const getIsVarFileAttribute = (variable: ValueSelector) => {
    if (variable.length !== 3)
      return false
    const parentVariable = variable.slice(0, 2)
    const varType = getCurrentVariableType({
      parentNode: iterationNode,
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
