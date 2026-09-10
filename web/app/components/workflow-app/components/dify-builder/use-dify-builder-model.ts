import type { SessionModel } from './types'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { difyBuilderSelectedModelAtom, difyBuilderSessionModelAtom } from './store'

export const useDifyBuilderModel = () => {
  const selectedModel = useAtomValue(difyBuilderSelectedModelAtom)
  const sessionModel = useAtomValue(difyBuilderSessionModelAtom)
  const { data: defaultModel } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { activeTextGenerationModelList } = useTextGenerationCurrentProviderAndModelAndModelList()
  const model = useMemo<SessionModel | null>(() => {
    if (selectedModel) return selectedModel
    if (sessionModel) return sessionModel
    if (!defaultModel) return null

    const provider = defaultModel.provider.provider
    const targetProvider = activeTextGenerationModelList.find((item) => item.provider === provider)
    const targetModel = targetProvider?.models.find((item) => item.model === defaultModel.model)
    if (!targetModel || targetModel.status !== ModelStatusEnum.active) return null

    return {
      provider,
      name: defaultModel.model,
      mode: String(targetModel.model_properties.mode ?? ''),
      completion_params: {},
    }
  }, [activeTextGenerationModelList, defaultModel, selectedModel, sessionModel])

  return { model, modelList: activeTextGenerationModelList }
}
