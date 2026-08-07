import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DatasetConfigs, ModelConfig, PromptMode } from '@/models/debug'
import type { ModelConfig as BackendModelConfig } from '@/types/app'

export type ConfigurationPublishConfig = {
  modelConfig: ModelConfig
  completionParams: FormValue
  promptMode: PromptMode
  chatPromptConfig: NonNullable<BackendModelConfig['chat_prompt_config']>
  completionPromptConfig: NonNullable<BackendModelConfig['completion_prompt_config']>
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: NonNullable<BackendModelConfig['external_data_tools']>
}
