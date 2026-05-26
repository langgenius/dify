import type { ValueSelector } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useIsChatMode, useWorkflow, useWorkflowVariables } from '@/app/components/workflow/hooks/index'
import { VarType } from '@/app/components/workflow/types'

type Params = {
  nodeId: string
}
const useIsVarFileAttribute = ({
  nodeId,
}: Params) => {
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(nodeId)
  }, [getBeforeNodesInSameBranch, nodeId])
  const { getCurrentVariableType } = useWorkflowVariables()
  const getIsVarFileAttribute = (variable: ValueSelector) => {
    if (variable.length !== 3)
      return false
    const parentVariable = variable.slice(0, 2)
    const varType = getCurrentVariableType({
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
