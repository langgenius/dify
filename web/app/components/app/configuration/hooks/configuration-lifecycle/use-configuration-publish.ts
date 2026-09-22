import type { Dispatch, SetStateAction } from 'react'
import type { SelectorTranslate } from '../../utils'
import type { ConfigurationPublishConfig } from './types'
import type { AppPublisherPublishParams } from '@/app/components/app/app-publisher/types'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs, ModelConfig } from '@/models/debug'
import type { AppModeEnum, ModelConfig as BackendModelConfig, ModelModeType } from '@/types/app'
import { useCallback } from 'react'
import { createPublishHandler } from './publish'

type UseConfigurationPublishParams = {
  appId: string
  canReleaseAndVersion: boolean
  chatPromptConfig: BackendModelConfig['chat_prompt_config']
  completionParams: FormValue
  completionPromptConfig: BackendModelConfig['completion_prompt_config']
  contextVar?: string
  contextVarEmpty: boolean
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: BackendModelConfig['external_data_tools']
  hasSetBlockStatus: { history: boolean; query: boolean }
  isAdvancedMode: boolean
  isFunctionCall: boolean
  mode: AppModeEnum
  modelConfig: ModelConfig
  promptEmpty: boolean
  promptMode: BackendModelConfig['prompt_type']
  resolvedModelModeType: ModelModeType
  setCanReturnToSimpleMode: (value: boolean) => void
  setPublishedConfig: Dispatch<SetStateAction<ConfigurationPublishConfig | null>>
  syncToPublishedConfig: (config: ConfigurationPublishConfig) => void
  t: SelectorTranslate<'appDebug' | 'common'>
  updateModelConfig: (params: { url: string; body: BackendModelConfig }) => Promise<unknown>
}

export function useConfigurationPublish({
  appId,
  canReleaseAndVersion,
  chatPromptConfig,
  completionParams,
  completionPromptConfig,
  contextVar,
  contextVarEmpty,
  dataSets,
  datasetConfigs,
  externalDataToolsConfig,
  hasSetBlockStatus,
  isAdvancedMode,
  isFunctionCall,
  mode,
  modelConfig,
  promptEmpty,
  promptMode,
  resolvedModelModeType,
  setCanReturnToSimpleMode,
  setPublishedConfig,
  syncToPublishedConfig,
  t,
  updateModelConfig,
}: UseConfigurationPublishParams) {
  return useCallback(
    async (params?: AppPublisherPublishParams, features?: FeaturesData) => {
      if (!canReleaseAndVersion) return

      const modelAndParameter =
        params && 'model' in params && 'provider' in params && 'parameters' in params
          ? params
          : undefined
      const handlePublishedConfigChange = (config: ConfigurationPublishConfig) => {
        setPublishedConfig(config)
        if (modelAndParameter) syncToPublishedConfig(config)
      }
      const result = await createPublishHandler({
        appId,
        chatPromptConfig,
        completionParamsState: completionParams,
        completionPromptConfig,
        contextVar,
        contextVarEmpty,
        dataSets,
        datasetConfigs,
        externalDataToolsConfig,
        hasSetBlockStatus,
        isAdvancedMode,
        isFunctionCall,
        mode,
        modelConfig,
        promptEmpty,
        promptMode,
        resolvedModelModeType,
        setCanReturnToSimpleMode,
        setPublishedConfig: handlePublishedConfigChange,
        t,
      })(updateModelConfig, modelAndParameter, features)

      return result
    },
    [
      appId,
      canReleaseAndVersion,
      chatPromptConfig,
      completionParams,
      completionPromptConfig,
      contextVar,
      contextVarEmpty,
      dataSets,
      datasetConfigs,
      externalDataToolsConfig,
      hasSetBlockStatus,
      isAdvancedMode,
      isFunctionCall,
      mode,
      modelConfig,
      promptEmpty,
      promptMode,
      resolvedModelModeType,
      setCanReturnToSimpleMode,
      setPublishedConfig,
      syncToPublishedConfig,
      t,
      updateModelConfig,
    ],
  )
}
