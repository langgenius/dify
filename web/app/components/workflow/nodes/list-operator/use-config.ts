import type { ValueSelector, Var } from '../../types'
import type { Condition, Limit, ListFilterNodeType, OrderBy } from './types'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  canFilterVariable,
  getItemVarType,
  getItemVarTypeShowName,
  supportsSubVariable,
  updateExtractEnabled,
  updateExtractSerial,
  updateFilterCondition,
  updateFilterEnabled,
  updateLimit,
  updateListFilterVariable,
  updateOrderByEnabled,
  updateOrderByKey,
  updateOrderByType,
} from './use-config.helpers'

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
  const isInLoop = payload.isInLoop
  const loopNode = isInLoop ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(id)
  }, [getBeforeNodesInSameBranch, id])

  const { inputs, setInputs } = useNodeCrud<ListFilterNodeType>(id, payload)

  const { getCurrentVariableType } = useWorkflowVariables()

  const getType = useCallback((variable?: ValueSelector) => {
    const varType = getCurrentVariableType({
      parentNode: isInIteration ? iterationNode : loopNode,
      valueSelector: variable || inputs.variable || [],
      availableNodes,
      isChatMode,
      isConstant: false,
    })
    const itemVarType = getItemVarType(varType)
    return { varType, itemVarType }
  }, [availableNodes, getCurrentVariableType, inputs.variable, isChatMode, isInIteration, iterationNode, loopNode])

  const { varType, itemVarType } = getType()

  const itemVarTypeShowName = useMemo(() => getItemVarTypeShowName(itemVarType, !!inputs.variable), [inputs.variable, itemVarType])

  const hasSubVariable = supportsSubVariable(varType)

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const nextType = getType(variable as ValueSelector)
    setInputs(updateListFilterVariable({
      inputs,
      variable: variable as ValueSelector,
      varType: nextType.varType,
      itemVarType: nextType.itemVarType,
    }))
  }, [getType, inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => canFilterVariable(varPayload), [])

  const handleFilterEnabledChange = useCallback((enabled: boolean) => {
    setInputs(updateFilterEnabled(inputs, enabled))
  }, [inputs, setInputs])

  const handleFilterChange = useCallback((condition: Condition) => {
    setInputs(updateFilterCondition(inputs, condition))
  }, [inputs, setInputs])

  const handleLimitChange = useCallback((limit: Limit) => {
    setInputs(updateLimit(inputs, limit))
  }, [inputs, setInputs])

  const handleExtractsEnabledChange = useCallback((enabled: boolean) => {
    setInputs(updateExtractEnabled(inputs, enabled))
  }, [inputs, setInputs])

  const handleExtractsChange = useCallback((value: string) => {
    setInputs(updateExtractSerial(inputs, value))
  }, [inputs, setInputs])

  const handleOrderByEnabledChange = useCallback((enabled: boolean) => {
    setInputs(updateOrderByEnabled(inputs, enabled, hasSubVariable))
  }, [hasSubVariable, inputs, setInputs])

  const handleOrderByKeyChange = useCallback((key: string) => {
    setInputs(updateOrderByKey(inputs, key))
  }, [inputs, setInputs])

  const handleOrderByTypeChange = useCallback((type: OrderBy) => {
    return () => {
      setInputs(updateOrderByType(inputs, type))
    }
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterVar,
    varType,
    itemVarType,
    itemVarTypeShowName,
    hasSubVariable,
    handleVarChanges,
    handleFilterEnabledChange,
    handleFilterChange,
    handleLimitChange,
    handleOrderByEnabledChange,
    handleOrderByKeyChange,
    handleOrderByTypeChange,
    handleExtractsEnabledChange,
    handleExtractsChange,
  }
}

export default useConfig
