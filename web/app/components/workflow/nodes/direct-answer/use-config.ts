import { useCallback, useState } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { DirectAnswerNodeType } from './types'

const useConfig = (initInputs: DirectAnswerNodeType) => {
  const [inputs, setInputs] = useState<DirectAnswerNodeType>(initInputs)
  // variables
  const { handleVarListChange, handleAddVariable } = useVarList<DirectAnswerNodeType>({
    inputs,
    setInputs,
  })

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
