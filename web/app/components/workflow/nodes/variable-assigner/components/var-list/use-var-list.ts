import { useCallback } from 'react'
import produce from 'immer'
import type { VariableAssignerNodeType } from '../../types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { useEdgesInteractions } from '@/app/components/workflow/hooks'

type Params = {
  id: string
  inputs: VariableAssignerNodeType
  setInputs: (newInputs: VariableAssignerNodeType) => void
}
function useVarList({
  id,
  inputs,
  setInputs,
}: Params) {
  const { handleVariableAssignerEdgesChange } = useEdgesInteractions()
  const handleVarListChange = useCallback((newList: ValueSelector[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
    })
    setInputs(newInputs)
    handleVariableAssignerEdgesChange(id, newList)
  }, [inputs, setInputs, id, handleVariableAssignerEdgesChange])

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
