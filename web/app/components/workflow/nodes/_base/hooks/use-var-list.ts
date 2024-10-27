import { useCallback } from 'react'
import produce from 'immer'
import type { Variable } from '@/app/components/workflow/types'

type Params<T> = {
  inputs: T
  setInputs: (newInputs: T) => void
  varKey?: string
}
function useVarList<T>({
  inputs,
  setInputs,
  varKey = 'variables',
}: Params<T>) {
  const handleVarListChange = useCallback((newList: Variable[] | string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newList as Variable[]
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey].push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs, varKey])
  return {
    handleVarListChange,
    handleAddVariable,
  }
}

export default useVarList
