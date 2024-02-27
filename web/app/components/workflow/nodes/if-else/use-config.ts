import { useCallback, useState } from 'react'
import produce from 'immer'
import { ComparisonOperator, LogicalOperator } from './types'
import type { Condition, IfElseNodeType } from './types'

const useConfig = (initInputs: IfElseNodeType) => {
  const [inputs, setInputs] = useState<IfElseNodeType>(initInputs)

  const handleConditionsChange = useCallback((newConditions: Condition[]) => {
    setInputs((prev) => {
      return {
        ...prev,
        conditions: newConditions,
      }
    })
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
