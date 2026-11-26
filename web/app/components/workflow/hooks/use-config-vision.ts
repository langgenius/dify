import type { ModelConfig, VisionSetting } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  getCurrentProviderAndModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import { Resolution } from '@/types/app'

export type VisionConfig = {
  enabled: boolean
  configs?: VisionSetting
}

type Params = {
  payload: VisionConfig
  onChange: (payload: VisionConfig) => void
}
const useConfigVision = (
  model: ModelConfig,
  {
    payload = {
      enabled: false,
    },
    onChange,
  }: Params,
) => {
  const { currentModel: currModel, textGenerationModelList } =
    useTextGenerationCurrentProviderAndModelAndModelList({
      provider: model.provider,
      model: model.name,
    })

  const isChatflow = useAtomValue(isChatflowAtom)

  const isVisionModel = !!currModel?.features?.includes(ModelFeatureEnum.vision)

  const handleVisionResolutionEnabledChange = useCallback(
    (enabled: boolean) => {
      const newPayload = produce(payload, (draft) => {
        draft.enabled = enabled
        if (enabled && isChatflow) {
          draft.configs = {
            detail: Resolution.high,
            variable_selector: ['sys', 'files'],
          }
        } else if (!enabled) {
          delete draft.configs
        }
      })
      onChange(newPayload)
    },
    [isChatflow, onChange, payload],
  )

  const handleVisionResolutionChange = useCallback(
    (config: VisionSetting) => {
      const newPayload = produce(payload, (draft) => {
        draft.configs = config
      })
      onChange(newPayload)
    },
    [onChange, payload],
  )

  const getVisionAfterModelChange = useCallback(
    (nextModel: ModelConfig, vision: VisionConfig = { enabled: false }): VisionConfig => {
      const { currentModel } = getCurrentProviderAndModel(textGenerationModelList, {
        provider: nextModel.provider,
        model: nextModel.name,
      })
      if (!currentModel?.features?.includes(ModelFeatureEnum.vision)) return { enabled: false }
      if (!vision.enabled) return vision
      return {
        enabled: true,
        configs: { detail: Resolution.high, variable_selector: [] },
      }
    },
    [textGenerationModelList],
  )

  return {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    getVisionAfterModelChange,
  }
}

export default useConfigVision
