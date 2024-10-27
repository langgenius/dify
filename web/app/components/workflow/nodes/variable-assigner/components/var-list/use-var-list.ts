import { useCallback } from 'react'
import produce from 'immer'
import type { VariableAssignerNodeType } from '../../types'
import type { ValueSelector } from '@/app/components/workflow/types'

type Params = {
  id: string
  inputs: VariableAssignerNodeType
  setInputs: (newInputs: VariableAssignerNodeType) => void
}
function useVarList({
  inputs,
  setInputs,
}: Params) {
  const handleVarListChange = useCallback((newList: ValueSelector[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables.push([])
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  return {
    handleVarListChange,
    handleAddVariable,
  }
}

export default useVarList
