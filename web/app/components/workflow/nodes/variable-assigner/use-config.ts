import { useCallback, useState } from 'react'
import produce from 'immer'
import useVarList from './components/var-list/use-var-list'
import type { VariableAssignerNodeType } from './types'

const useConfig = (initInputs: VariableAssignerNodeType) => {
  const [inputs, setInputs] = useState<VariableAssignerNodeType>(initInputs)

  const handleOutputTypeChange = useCallback((outputType: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.output_type = outputType
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const { handleVarListChange, handleAddVariable } = useVarList({
    inputs,
    setInputs,
  })
  return {
    inputs,
    handleOutputTypeChange,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
