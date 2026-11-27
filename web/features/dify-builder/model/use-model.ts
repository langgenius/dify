import type { SessionModel } from '../types'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { difyBuilderSelectedModelAtom, difyBuilderSessionModelAtom } from '../state'

export const useDifyBuilderModel = ({ enabled = true }: { enabled?: boolean } = {}) => {
  const selectedModel = useAtomValue(difyBuilderSelectedModelAtom)
  const sessionModel = useAtomValue(difyBuilderSessionModelAtom)
  const explicitModel = selectedModel ?? sessionModel
  const defaultEnabled = enabled && !explicitModel
  const {
    data: defaultModel,
    isPending: defaultPending,
    isError: defaultError,
    refetch: refetchDefault,
  } = useQuery(
    consoleQuery.workspaces.current.defaultModel.get.queryOptions({
      input: { query: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data ?? undefined,
      enabled: defaultEnabled,
    }),
  )
  const {
    data: modelProviders,
    isPending: modelsPending,
    isError: modelsError,
    refetch: refetchModels,
  } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
      enabled,
    }),
  )
  const activeTextGenerationModelList = useMemo(
    () => (modelProviders ?? []).filter((provider) => provider.status === ModelStatusEnum.active),
    [modelProviders],
  )
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
  const isError =
    (defaultEnabled && defaultError && defaultModel === undefined) ||
    (enabled && modelsError && modelProviders === undefined)

  return {
    model,
    selection: explicitModel ?? model,
    modelList: activeTextGenerationModelList,
    isLoading: !isError && ((defaultEnabled && defaultPending) || (enabled && modelsPending)),
    isError,
    hasAvailableModels: activeTextGenerationModelList.some((provider) =>
      provider.models.some((model) => model.status === ModelStatusEnum.active),
    ),
    retry,
  }
}
