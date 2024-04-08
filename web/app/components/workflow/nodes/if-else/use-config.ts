import { useCallback } from 'react'
import produce from 'immer'
import type { Var } from '../../types'
import { VarType } from '../../types'
import { getVarType } from '../_base/components/variable/utils'
import { LogicalOperator } from './types'
import type { Condition, IfElseNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: IfElseNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()
  const availableNodes = getBeforeNodesInSameBranch(id)

  const { inputs, setInputs } = useNodeCrud<IfElseNodeType>(id, payload)

  const handleConditionsChange = useCallback((newConditions: Condition[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.conditions = newConditions
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddCondition = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.conditions.push({
        id: `${Date.now()}`,
        variable_selector: [],
        comparison_operator: undefined,
        value: '',
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleLogicalOperatorToggle = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.logical_operator = draft.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type !== VarType.arrayFile
  }, [])

  const varTypesList = (inputs.conditions || []).map((condition) => {
    return getVarType(condition.variable_selector, availableNodes, isChatMode)
  })

  return {
    readOnly,
    inputs,
    handleConditionsChange,
    handleAddCondition,
    handleLogicalOperatorToggle,
    varTypesList,
    filterVar,
  }
}

export default useConfig
