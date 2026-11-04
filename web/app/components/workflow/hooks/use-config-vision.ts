import type { ModelConfig, VisionSetting } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import { Resolution } from '@/types/app'

type Payload = {
  enabled: boolean
  configs?: VisionSetting
}

type Params = {
  payload: Payload
  onChange: (payload: Payload) => void
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
  const { currentModel: currModel } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: model.provider,
    model: model.name,
  })

  const isChatflow = useAtomValue(isChatflowAtom)

  const getIsVisionModel = useCallback(() => {
    return !!currModel?.features?.includes(ModelFeatureEnum.vision)
  }, [currModel])

  const isVisionModel = getIsVisionModel()

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

  const handleModelChanged = useCallback(() => {
    const isVisionModel = getIsVisionModel()
    if (!isVisionModel) {
      handleVisionResolutionEnabledChange(false)
      return
    }
    if (payload.enabled) {
      onChange({
        enabled: true,
        configs: {
          detail: Resolution.high,
          variable_selector: [],
        },
      })
    }
  }, [getIsVisionModel, handleVisionResolutionEnabledChange, onChange, payload.enabled])

  return {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged,
  }
}

export default useConfigVision
