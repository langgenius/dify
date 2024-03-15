import { useCallback } from 'react'
import produce from 'immer'
import useVarList from './components/var-list/use-var-list'
import type { VariableAssignerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import type { Var, VarType } from '@/app/components/workflow/types'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)

  const handleOutputTypeChange = useCallback((outputType: string) => {
    const newInputs = produce(inputs, (draft: VariableAssignerNodeType) => {
      draft.output_type = outputType as VarType
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const { handleVarListChange, handleAddVariable } = useVarList({
    id,
    inputs,
    setInputs,
  })

  const filterVar = useCallback((varPayload: Var) => {
    if (varPayload.type !== inputs.output_type)
      return false
    return true
  }, [inputs])
  return {
    inputs,
    handleOutputTypeChange,
    handleVarListChange,
    handleAddVariable,
    filterVar,
  }
}

export default useConfig
