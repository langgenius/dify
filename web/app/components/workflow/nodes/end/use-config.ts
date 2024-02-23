import produce from 'immer'
import { useCallback, useState } from 'react'
import useVarList from '../_base/hooks/use-var-list'
import type { EndNodeType, EndVarType, OutPuts } from './types'

const useConfig = (initInputs: EndNodeType) => {
  const [inputs, setInputs] = useState<EndNodeType>(initInputs)
  const handleOutputTypeChange = useCallback((type: EndVarType) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.outputs.type = type
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handelPlainTextSelectorChange = useCallback((newList: string[]) => {
    const newInputs = produce(inputs, (draft: any) => {
      draft.outputs.plain_text_selector = newList
    })
    setInputs(newInputs)
  }
  , [inputs, setInputs])

  const { handleVarListChange, handleAddVariable } = useVarList<OutPuts>({
    inputs: inputs.outputs,
    setInputs: (newOutputs) => {
      const newInputs = produce(inputs, (draft: any) => {
        draft.outputs = newOutputs
      })
      setInputs(newInputs)
    },
    varKey: 'structured_variables',
  })

  return {
    inputs,
    handleOutputTypeChange,
    handelPlainTextSelectorChange,
    handleVarListChange,
    handleAddVariable,
  }
}

export default useConfig
