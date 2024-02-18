import { useCallback, useState } from 'react'
import produce from 'immer'
import type { LLMNodeData } from '../../types'
const useInput = (initInputs: LLMNodeData) => {
  const [inputs, setInputs] = useState<LLMNodeData>(initInputs)

  const handleModelChanged = useCallback((model: { provider: string; model: string }) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.model
    })
    setInputs(newInputs)
  }, [inputs.model])
  return {
    inputs,
    setInputs: (key: string, payload: any) => {
      setInputs({
        ...inputs,
        [key]: payload,
      } as LLMNodeData)
    },
    handleModelChanged,
  }
}

export default useInput
