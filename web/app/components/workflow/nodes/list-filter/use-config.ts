import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import type { ValueSelector, Var } from '../../types'
import { VarType } from '../../types'
import type { Limit, ListFilterNodeType, OrderBy } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: ListFilterNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const store = useStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()

  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === id)
  const isInIteration = payload.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(id)
  }, [getBeforeNodesInSameBranch, id])

  const { inputs, setInputs } = useNodeCrud<ListFilterNodeType>(id, payload)

  const { getCurrentVariableType } = useWorkflowVariables()
  const varType = getCurrentVariableType({
    parentNode: iterationNode,
    valueSelector: inputs.variable || [],
    availableNodes,
    isChatMode,
    isConstant: false,
  })

  const hasSubVariable = [VarType.arrayFile, VarType.arrayObject].includes(varType)

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return [VarType.arrayNumber, VarType.arrayString, VarType.arrayFile, VarType.arrayObject].includes(varPayload.type)
  }, [])

  const handleLimitChange = useCallback((limit: Limit) => {
    const newInputs = produce(inputs, (draft) => {
      draft.limit = limit
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleOrderByEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.order_by.enabled = enabled
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleOrderByTypeChange = useCallback((type: OrderBy) => {
    return () => {
      const newInputs = produce(inputs, (draft) => {
        draft.order_by.value = type
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterVar,
    hasSubVariable,
    handleVarChanges,
    handleLimitChange,
    handleOrderByEnabledChange,
    handleOrderByTypeChange,
  }
}

export default useConfig
