import { useCallback, useState } from 'react'
import produce from 'immer'
import type { Variable } from '../../types'
import type { LLMNodeType } from './types'

const useConfig = (initInputs: LLMNodeType) => {
  const [inputs, setInputs] = useState<LLMNodeType>(initInputs)

  // model
  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // variables
  const handleVarListChange = useCallback((newList: Variable[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables = newList
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddVariable = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.variables.push({
        variable: '',
        value_selector: [],
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // context
  const toggleContextEnabled = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.enabled = !draft.context.enabled
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    toggleContextEnabled,
  }
}

export default useConfig
