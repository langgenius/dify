import { useCallback } from 'react'
import produce from 'immer'
import { type OutputVar, OutputVarType } from '../../code/types'
type Params<T> = {
  inputs: T
  setInputs: (newInputs: T) => void
  varKey?: string
}
function useOutputVarList<T>({
  inputs,
  setInputs,
  varKey = 'outputs',
}: Params<T>) {
  const handleVarsChange = useCallback((newVars: OutputVar) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newVars
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = {
        ...draft[varKey],
        [`var-${Object.keys(draft[varKey]).length + 1}`]: {
          type: OutputVarType.string,
          children: null,
        },
      }
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])

  return {
    handleVarsChange,
    handleAddVariable,
  }
}

export default useOutputVarList
