import { useCallback, useState } from 'react'
import produce from 'immer'
import useVarList from '../_base/hooks/use-var-list'
import type { Memory, ValueSelector } from '../../types'
import type { LLMNodeType } from './types'
import type { Resolution } from '@/types/app'

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
  const { handleVarListChange, handleAddVariable } = useVarList<LLMNodeType>({
    inputs,
    setInputs,
  })

  // context
  const handleContextVarChange = useCallback((newVar: ValueSelector) => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.variable_selector = newVar
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleMemoryChange = useCallback((newMemory: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = newMemory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleVisionResolutionChange = useCallback((newResolution: Resolution) => {
    const newInputs = produce(inputs, (draft) => {
      draft.vision.configs.detail = newResolution
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
    handleVarListChange,
    handleAddVariable,
    handleContextVarChange,
    handleMemoryChange,
    handleVisionResolutionChange,
  }
}

export default useConfig
