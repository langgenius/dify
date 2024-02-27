import { useCallback, useState } from 'react'
import produce from 'immer'
import type { Condition, IfElseNodeType, LogicalOperator } from './types'

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

  const handleAddCondition = useCallback((condition: Condition) => {
    const newInputs = produce(inputs, (draft) => {
      draft.conditions.push(condition)
    })
    setInputs(newInputs)
  }, [inputs])

  const handleLogicalOperatorChange = useCallback((newOperator: LogicalOperator) => {
    const newInputs = produce(inputs, (draft) => {
      draft.logical_operator = newOperator
    })
    setInputs(newInputs)
  }, [inputs])

  return {
    inputs,
    handleConditionsChange,
    handleAddCondition,
    handleLogicalOperatorChange,
  }
}

export default useConfig
