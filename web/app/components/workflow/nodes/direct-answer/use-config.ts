import { useCallback, useState } from 'react'
import produce from 'immer'
import type { Variable } from '../../types'
import type { DirectAnswerNodeType } from './types'

const useConfig = (initInputs: DirectAnswerNodeType) => {
  const [inputs, setInputs] = useState<DirectAnswerNodeType>(initInputs)
  // variables
  const handleVarListChange = useCallback((newList: Variable[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables.push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAnswerChange = useCallback((value: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.answer = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
    handleAnswerChange,
  }
}

export default useConfig
