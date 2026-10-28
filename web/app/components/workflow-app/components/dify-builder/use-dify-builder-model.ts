import type { SessionModel } from './types'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  useDefaultModel,
  useTextGenerationCurrentProviderAndModelAndModelList,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { difyBuilderSelectedModelAtom, difyBuilderSessionModelAtom } from './store'

export const useDifyBuilderModel = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const selectedModel = useAtomValue(difyBuilderSelectedModelAtom)
  const sessionModel = useAtomValue(difyBuilderSessionModelAtom)
  const explicitModel = selectedModel ?? sessionModel
  const {
    data: defaultModel,
    isLoading: defaultLoading,
    isError: defaultError,
    mutate: refetchDefault,
  } = useDefaultModel(ModelTypeEnum.textGeneration, { enabled: enabled && !explicitModel })
  const {
    activeTextGenerationModelList,
    isLoading: modelsLoading,
    isError: modelsError,
    refetch: refetchModels,
  } = useTextGenerationCurrentProviderAndModelAndModelList(undefined, { enabled })
  const model = useMemo<SessionModel | null>(() => {
    const candidate =
      explicitModel ??
      (defaultModel ? { provider: defaultModel.provider.provider, name: defaultModel.model } : null)
    if (!candidate) return null
    const { provider, name } = candidate
    const targetProvider = activeTextGenerationModelList.find((item) => item.provider === provider)
    const targetModel = targetProvider?.models.find((item) => item.model === name)
    if (!targetModel || targetModel.status !== ModelStatusEnum.active) return null

    if (explicitModel) return explicitModel
    return {
      provider,
      name,
      mode: String(targetModel.model_properties.mode ?? ''),
      completion_params: {},
    }
  }, [activeTextGenerationModelList, defaultModel, explicitModel])

  const retry = useCallback(async () => {
    await Promise.all([explicitModel ? undefined : refetchDefault(), refetchModels()])
  }, [explicitModel, refetchDefault, refetchModels])
  const isError = defaultError || modelsError

  return {
    model,
    selection: explicitModel ?? model,
    modelList: activeTextGenerationModelList,
    isLoading: !isError && (defaultLoading || modelsLoading),
    isError,
    hasAvailableModels: activeTextGenerationModelList.some((provider) =>
      provider.models.some((model) => model.status === ModelStatusEnum.active),
    ),
    retry,
  }
}
