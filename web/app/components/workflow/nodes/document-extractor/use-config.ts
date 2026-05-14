import type { ValueSelector, Var } from '../../types'
import type { DocExtractorNodeType } from './types'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarType } from '../../types'

const useConfig = (id: string, payload: DocExtractorNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<DocExtractorNodeType>(id, payload)

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.file || varPayload.type === VarType.arrayFile
  }, [])

  const isChatMode = useIsChatMode()

  const store = useWorkflowStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const {
    nodes,
  } = store.getState()
  const currentNode = nodes.find(n => n.id === id)
  const isInIteration = payload.isInIteration
  const iterationNode = isInIteration ? nodes.find(n => n.id === currentNode!.parentId) : null
  const isInLoop = payload.isInLoop
  const loopNode = isInLoop ? nodes.find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(id)
  }, [getBeforeNodesInSameBranch, id])

  const { getCurrentVariableType } = useWorkflowVariables()
  const getType = useCallback((variable?: ValueSelector) => {
    const varType = getCurrentVariableType({
      parentNode: isInIteration ? iterationNode : loopNode,
      valueSelector: variable || [],
      availableNodes,
      isChatMode,
      isConstant: false,
    })
    return varType
  }, [getCurrentVariableType, isInIteration, availableNodes, isChatMode, iterationNode, loopNode])

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable_selector = variable as ValueSelector
      draft.is_array_file = getType(draft.variable_selector) === VarType.arrayFile
    })
    setInputs(newInputs)
  }, [getType, inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterVar,
    handleVarChanges,
  }
}

export default useConfig
