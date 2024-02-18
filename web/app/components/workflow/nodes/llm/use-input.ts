import { useCallback, useState } from 'react'
import produce from 'immer'
import type { LLMNodeData } from '../../types'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'

const useInput = (initInputs: LLMNodeData) => {
  const {
    textGenerationModelList,
  } = useTextGenerationCurrentProviderAndModelAndModelList()

  const [inputs, setInputs] = useState<LLMNodeData>(initInputs)

  const handleModelChanged = useCallback((model: { provider: string; model: string }) => {
    const targetProvider = textGenerationModelList.find(modelItem => modelItem.provider === model.provider)
    const targetModelItem = targetProvider?.models.find(modelItem => modelItem.model === model.model)
    const newInputs = produce(inputs, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.model
      draft.model.mode = targetModelItem?.model_properties.mode as string
    })
    setInputs(newInputs)
  }, [inputs.model, textGenerationModelList])

  const toggleContextEnabled = useCallback(() => {
    const newInputs = produce(inputs, (draft) => {
      draft.context.enabled = !draft.context.enabled
    })
    setInputs(newInputs)
  }, [inputs.context.enabled])

  return {
    textGenerationModelList,
    inputs,
    handleModelChanged,
    toggleContextEnabled,
  }
}

export default useInput
