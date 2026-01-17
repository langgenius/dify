import type { ValueSelector, Var } from '../../types'
import type { Condition, Limit, ListFilterNodeType } from './types'
import { produce } from 'immer'
import { useCallback, useMemo } from 'react'
import { useStoreApi } from 'reactflow'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarType } from '../../types'
import { getOperators } from '../if-else/utils'
import { OrderBy } from './types'

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
    let itemVarType
    switch (varType) {
      case VarType.arrayNumber:
        itemVarType = VarType.number
        break
      case VarType.arrayString:
        itemVarType = VarType.string
        break
      case VarType.arrayFile:
        itemVarType = VarType.file
        break
      case VarType.arrayObject:
        itemVarType = VarType.object
        break
      case VarType.arrayBoolean:
        itemVarType = VarType.boolean
        break
      default:
        itemVarType = varType
    }
    return { varType, itemVarType }
  }, [availableNodes, getCurrentVariableType, inputs.variable, isChatMode, isInIteration, iterationNode, loopNode])

  const { varType, itemVarType } = getType()

  const itemVarTypeShowName = useMemo(() => {
    if (!inputs.variable)
      return '?'
    return [(itemVarType || VarType.string).substring(0, 1).toUpperCase(), (itemVarType || VarType.string).substring(1)].join('')
  }, [inputs.variable, itemVarType])

  const hasSubVariable = [VarType.arrayFile].includes(varType)

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable = variable as ValueSelector
      const { varType, itemVarType } = getType(draft.variable)
      const isFileArray = varType === VarType.arrayFile

      draft.var_type = varType
      draft.item_var_type = itemVarType
      draft.filter_by.conditions = [{
        key: (isFileArray && !draft.filter_by.conditions[0]?.key) ? 'name' : '',
        comparison_operator: getOperators(itemVarType, isFileArray ? { key: 'name' } : undefined)[0],
        value: itemVarType === VarType.boolean ? false : '',
      }]
      if (isFileArray && draft.order_by.enabled && !draft.order_by.key)
        draft.order_by.key = 'name'
    })
    setInputs(newInputs)
  }, [getType, inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    // Don't know the item struct of VarType.arrayObject, so not support it
    return [VarType.arrayNumber, VarType.arrayString, VarType.arrayBoolean, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const handleFilterEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.filter_by.enabled = enabled
      if (enabled && !draft.filter_by.conditions)
        draft.filter_by.conditions = []
    })
    setInputs(newInputs)
  }, [hasSubVariable, inputs, setInputs])

  const handleFilterChange = useCallback((condition: Condition) => {
    const newInputs = produce(inputs, (draft) => {
      draft.filter_by.conditions[0] = condition
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleLimitChange = useCallback((limit: Limit) => {
    const newInputs = produce(inputs, (draft) => {
      draft.limit = limit
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleExtractsEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.extract_by.enabled = enabled
      if (enabled)
        draft.extract_by.serial = '1'
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleExtractsChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.extract_by.serial = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleOrderByEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      draft.order_by.enabled = enabled
      if (enabled) {
        draft.order_by.value = OrderBy.ASC
        if (hasSubVariable && !draft.order_by.key)
          draft.order_by.key = 'name'
      }
    })
    setInputs(newInputs)
  }, [hasSubVariable, inputs, setInputs])

  const handleOrderByKeyChange = useCallback((key: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.order_by.key = key
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
