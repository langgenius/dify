import type { SelectorTranslate } from '../../utils'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModelConfig } from '@/models/debug'
import type { VisionSettings } from '@/types/app'
import { produce } from 'immer'
import { useMemo } from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import { AppModeEnum, ModelModeType } from '@/types/app'
import { fetchAndMergeValidCompletionParams } from '@/utils/completion-params'
import { getStringSelectorTranslate } from '../../utils'

type ModelChangeHandlerOptions = {
  chatPromptLength: number
  completionParamsState: FormValue
  completionPromptConfig: {
    conversation_histories_role: {
      assistant_prefix: string
      user_prefix: string
    }
    prompt?: {
      text?: string
    }
  }
  handleSetVisionConfig: (config: VisionSettings, notNoticeFormattingChanged?: boolean) => void
  isAdvancedMode: boolean
  migrateToDefaultPrompt: (force?: boolean, modelModeType?: ModelModeType) => Promise<void>
  mode: AppModeEnum
  modelConfig: ModelConfig
  resolvedModelModeType: ModelModeType
  setCompletionParams: (value: FormValue) => void
  setModelConfig: (config: ModelConfig) => void
  t: SelectorTranslate<'appDebug' | 'common'>
  visionConfig: VisionSettings
}

export const createModelChangeHandler =
  ({
    chatPromptLength,
    completionParamsState,
    completionPromptConfig,
    handleSetVisionConfig,
    isAdvancedMode,
    migrateToDefaultPrompt,
    mode,
    modelConfig,
    resolvedModelModeType,
    setCompletionParams,
    setModelConfig,
    t: rawTranslate,
    visionConfig,
  }: ModelChangeHandlerOptions) =>
  async ({
    features = [],
    mode: nextModelMode = resolvedModelModeType,
    modelId,
    provider,
  }: {
    modelId: string
    provider: string
    mode?: string
    features?: string[]
  }) => {
    const t = getStringSelectorTranslate(rawTranslate)
    if (isAdvancedMode) {
      if (nextModelMode === ModelModeType.completion) {
        if (mode !== AppModeEnum.COMPLETION) {
          if (
            !completionPromptConfig.prompt?.text ||
            !completionPromptConfig.conversation_histories_role.assistant_prefix ||
            !completionPromptConfig.conversation_histories_role.user_prefix
          )
            await migrateToDefaultPrompt(true, ModelModeType.completion)
        } else if (!completionPromptConfig.prompt?.text) {
          await migrateToDefaultPrompt(true, ModelModeType.completion)
        }
      }

      if (nextModelMode === ModelModeType.chat && chatPromptLength === 0)
        await migrateToDefaultPrompt(true, ModelModeType.chat)
    }

    setModelConfig(
      produce(modelConfig, (draft: ModelConfig) => {
        draft.provider = provider
        draft.model_id = modelId
        draft.mode = nextModelMode as ModelModeType
      }),
    )
    handleSetVisionConfig(
      {
        ...visionConfig,
        enabled: !!features?.includes('vision'),
      },
      true,
    )

    try {
      const { params: filtered, removedDetails } = await fetchAndMergeValidCompletionParams(
        provider,
        modelId,
        completionParamsState,
        isAdvancedMode,
      )

      if (Object.keys(removedDetails).length)
        toast.warning(
          `${t(($) => $['modelProvider.parametersInvalidRemoved'], { ns: 'common' })}: ${Object.entries(
            removedDetails,
          )
            .map(([key, reason]) => `${key} (${reason})`)
            .join(', ')}`,
        )

      setCompletionParams(filtered)
    } catch {
      toast.error(t(($) => $.error, { ns: 'common' }))
      setCompletionParams({})
    }
  }

export function useModelChangeHandler({
  chatPromptLength,
  completionParamsState,
  completionPromptConfig,
  handleSetVisionConfig,
  isAdvancedMode,
  migrateToDefaultPrompt,
  mode,
  modelConfig,
  resolvedModelModeType,
  setCompletionParams,
  setModelConfig,
  t,
  visionConfig,
}: ModelChangeHandlerOptions) {
  return useMemo(
    () =>
      createModelChangeHandler({
        chatPromptLength,
        completionParamsState,
        completionPromptConfig,
        handleSetVisionConfig,
        isAdvancedMode,
        migrateToDefaultPrompt,
        mode,
        modelConfig,
        resolvedModelModeType,
        setCompletionParams,
        setModelConfig,
        t,
        visionConfig,
      }),
    [
      chatPromptLength,
      completionParamsState,
      completionPromptConfig,
      handleSetVisionConfig,
      isAdvancedMode,
      migrateToDefaultPrompt,
      mode,
      modelConfig,
      resolvedModelModeType,
      setCompletionParams,
      setModelConfig,
      t,
      visionConfig,
    ],
  )
}
