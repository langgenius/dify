import { useCallback } from 'react'
import produce from 'immer'
import type { OutputVar } from '../../code/types'
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
  const handleVarListChange = useCallback((newList: OutputVar[]) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey].push({
        variable: '',
        variable_type: 'string',
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])

  return {
    handleVarListChange,
    handleAddVariable,
  }
}

export default useOutputVarList
