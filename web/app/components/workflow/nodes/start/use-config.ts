import { useCallback, useState } from 'react'
import produce from 'immer'
import type { StartNodeType } from './types'
import type { InputVar } from '@/app/components/workflow/types'

const useConfig = (initInputs: StartNodeType) => {
  const [inputs, setInputs] = useState<StartNodeType>(initInputs)

  const handleVarListChange = useCallback((newList: InputVar[]) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddVariable = useCallback((payload: InputVar) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.variables.push(payload)
    })
    setInputs(newInputs)
  }, [inputs, setInputs])
  return {
    inputs,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
