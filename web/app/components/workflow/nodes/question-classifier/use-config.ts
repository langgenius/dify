import { useCallback, useState } from 'react'
import produce from 'immer'
import type { QuestionClassifierNodeType } from './types'

const useConfig = (initInputs: QuestionClassifierNodeType) => {
  const [inputs, setInputs] = useState<QuestionClassifierNodeType>(initInputs)

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

  return {
    inputs,
    handleModelChanged,
    handleCompletionParamsChange,
  }
}

export default useConfig
