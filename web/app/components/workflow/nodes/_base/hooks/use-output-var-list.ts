import { useCallback } from 'react'
import produce from 'immer'
import { type OutputVar } from '../../code/types'
import { VarType } from '@/app/components/workflow/types'

type Params<T> = {
  inputs: T
  setInputs: (newInputs: T) => void
  varKey?: string
  outputKeyOrders: string[]
  onOutputKeyOrdersChange: (newOutputKeyOrders: string[]) => void
}
function useOutputVarList<T>({
  inputs,
  setInputs,
  varKey = 'outputs',
  outputKeyOrders = [],
  onOutputKeyOrdersChange,
}: Params<T>) {
  const handleVarsChange = useCallback((newVars: OutputVar, changedIndex?: number, newKey?: string) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = newVars
    })
    setInputs(newInputs)

    if (changedIndex !== undefined) {
      const newOutputKeyOrders = produce(outputKeyOrders, (draft) => {
        draft[changedIndex] = newKey!
      })
      onOutputKeyOrdersChange(newOutputKeyOrders)
    }
  }, [inputs, setInputs, varKey, outputKeyOrders, onOutputKeyOrdersChange])

  const handleAddVariable = useCallback(() => {
    const newKey = `var-${Object.keys((inputs as any)[varKey]).length + 1}`
    const newInputs = produce(inputs, (draft: any) => {
      draft[varKey] = {
        ...draft[varKey],
        [newKey]: {
          type: VarType.string,
          children: null,
        },
      }
    })
    setInputs(newInputs)
    onOutputKeyOrdersChange([...outputKeyOrders, newKey])
  }, [inputs, setInputs, varKey, outputKeyOrders, onOutputKeyOrdersChange])

  const handleRemoveVariable = useCallback((index: number) => {
    const key = outputKeyOrders[index]
    const newInputs = produce(inputs, (draft: any) => {
      delete draft[varKey][key]
    })
    setInputs(newInputs)
    onOutputKeyOrdersChange(outputKeyOrders.filter((_, i) => i !== index))
  }, [inputs, setInputs, varKey, outputKeyOrders, onOutputKeyOrdersChange])

  return {
    handleVarsChange,
    handleAddVariable,
    handleRemoveVariable,
  }
}

export default useOutputVarList
