/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useState } from 'react'
import produce from 'immer'
import type { LLMNodeData, Variable } from '../../types'

const useInput = (initInputs: LLMNodeData) => {
  const [inputs, setInputs] = useState<LLMNodeData>(initInputs)

  // model
  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
    })
    setInputs(newInputs)
  }, [inputs.model])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs.model])

  // variables
  const handleVarListChange = useCallback((newList: Variable[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [inputs.variables])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables.push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(newInputs)
  }, [inputs.variables])

  // context
  const toggleContextEnabled = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.enabled = !draft.context.enabled
    })
    setInputs(newInputs)
  }, [inputs.context.enabled])

  return {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    toggleContextEnabled,
  }
}

export default useInput
