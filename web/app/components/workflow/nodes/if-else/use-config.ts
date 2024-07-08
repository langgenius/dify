import { useCallback } from 'react'
import produce from 'immer'
import { v4 as uuid4 } from 'uuid'
import type {
  Var,
} from '../../types'
import { VarType } from '../../types'
import { LogicalOperator } from './types'
import type {
  CaseItem,
  HandleAddCondition,
  HandleRemoveCondition,
  HandleUpdateCondition,
  HandleUpdateConditionLogicalOperator,
  IfElseNodeType,
} from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

const useConfig = (id: string, payload: IfElseNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<IfElseNodeType>(id, payload)

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarType.arrayFile
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const handleAddCase = useCallback(() => {
    const newInputs = produce(inputs, () => {
      if (inputs.cases) {
        inputs.cases.push({
          caseId: uuid4(),
          logical_operator: LogicalOperator.and,
          conditions: [],
        })
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRemoveCase = useCallback((caseId: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.cases = draft.cases?.filter(item => item.caseId !== caseId)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleSortCase = useCallback((newCases: (CaseItem & { id: string })[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.cases = newCases.filter(Boolean).map(item => ({
        id: item.id,
        caseId: item.caseId,
        logical_operator: item.logical_operator,
        conditions: item.conditions,
      }))
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddCondition = useCallback<HandleAddCondition>((caseId, valueSelector, varItem) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.caseId === caseId)
      if (targetCase) {
        targetCase.conditions.push({
          id: uuid4(),
          varType: varItem.type,
          variable_selector: valueSelector,
          comparison_operator: undefined,
          value: '',
        })
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((caseId, conditionId) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.caseId === caseId)
      if (targetCase)
        targetCase.conditions = targetCase.conditions.filter(item => item.id !== conditionId)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((caseId, conditionId, newCondition) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.caseId === caseId)
      if (targetCase) {
        const targetCondition = targetCase.conditions.find(item => item.id === conditionId)
        if (targetCondition)
          Object.assign(targetCondition, newCondition)
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleUpdateConditionLogicalOperator = useCallback<HandleUpdateConditionLogicalOperator>((caseId, value) => {
    const newInputs = produce(inputs, (draft) => {
      const targetCase = draft.cases?.find(item => item.caseId === caseId)
      if (targetCase)
        targetCase.logical_operator = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    filterVar,
    handleAddCase,
    handleRemoveCase,
    handleSortCase,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleUpdateConditionLogicalOperator,
    nodesOutputVars: availableVars,
    availableNodes: availableNodesWithParent,
  }
}

export default useConfig
