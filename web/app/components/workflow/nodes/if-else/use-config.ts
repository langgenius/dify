import { useCallback } from 'react'
import produce from 'immer'
import { ComparisonOperator, LogicalOperator } from './types'
import type { Condition, IfElseNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

const useConfig = (id: string, payload: IfElseNodeType) => {
  const { inputs, setInputs } = useNodeCrud<IfElseNodeType>(id, payload)

  const handleConditionsChange = useCallback((newConditions: Condition[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.conditions = newConditions
    })
    setInputs(newInputs)
  }, [])

  const handleAddCondition = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.conditions.push({
        id: `${Date.now()}`,
        variable_selector: [],
        comparison_operator: ComparisonOperator.equal,
        value: '',
      })
    })
    setInputs(newInputs)
  }, [inputs])

  const handleLogicalOperatorToggle = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.logical_operator = draft.logical_operator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    })
    setInputs(newInputs)
  }, [inputs])

  return {
    inputs,
    handleConditionsChange,
    handleAddCondition,
    handleLogicalOperatorToggle,
  }
}

export default useConfig
