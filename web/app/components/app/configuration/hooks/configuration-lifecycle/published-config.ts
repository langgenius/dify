import type { ConfigurationPublishConfig } from './types'
import type { Collection } from '@/app/components/tools/types'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs, ModelConfig } from '@/models/debug'
import type { ModelConfig as BackendModelConfig, UserInputFormItem } from '@/types/app'
import { DEFAULT_AGENT_SETTING } from '@/config'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, AppModeEnum } from '@/types/app'
import { correctModelProvider, correctToolProvider } from '@/utils'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { normalizeChatPromptConfig, normalizeCompletionPromptConfig } from './prompt-config'

type BackendAgentTool = ModelConfig['agentConfig']['tools'][number] & {
  dataset?: {
    enabled: boolean
    id: string
  }
  provider_id: string
  provider_name: string
  provider_type: string
  tool_name: string
}

type DeletedTool = {
  id?: string
  provider_id?: string
  tool_name: string
}

function buildPublishedModelConfig({
  backendModelConfig,
  collectionList,
  deletedTools,
  mode,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  collectionList: Collection[]
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}): ModelConfig {
  const model = backendModelConfig.model
  const agentModeTools = (backendModelConfig.agent_mode?.tools ?? []) as BackendAgentTool[]

  return {
    provider: correctModelProvider(model.provider),
    model_id: model.name,
    mode: model.mode,
    configs: {
      prompt_template: backendModelConfig.pre_prompt || '',
      prompt_variables: userInputsFormToPromptVariables(
        [
          ...backendModelConfig.user_input_form,
          ...(backendModelConfig.external_data_tools?.length
            ? backendModelConfig.external_data_tools.map((item) => ({
                external_data_tool: {
                  variable: item.variable as string,
                  label: item.label as string,
                  enabled: !!item.enabled,
                  type: item.type as string,
                  config: item.config,
                  required: true,
                  icon: item.icon,
                  icon_background: item.icon_background,
                },
              }))
            : []),
        ] as unknown as UserInputFormItem[],
        backendModelConfig.dataset_query_variable,
      ),
    },
    prompt_type: backendModelConfig.prompt_type,
    chat_prompt_config: normalizeChatPromptConfig(backendModelConfig.chat_prompt_config),
    completion_prompt_config: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    more_like_this: backendModelConfig.more_like_this ?? { enabled: false },
    opening_statement: backendModelConfig.opening_statement,
    suggested_questions: backendModelConfig.suggested_questions ?? [],
    sensitive_word_avoidance: backendModelConfig.sensitive_word_avoidance,
    speech_to_text: backendModelConfig.speech_to_text,
    text_to_speech: backendModelConfig.text_to_speech,
    file_upload: backendModelConfig.file_upload ?? null,
    suggested_questions_after_answer: backendModelConfig.suggested_questions_after_answer ?? {
      enabled: false,
    },
    retriever_resource: backendModelConfig.retriever_resource,
    annotation_reply: backendModelConfig.annotation_reply ?? null,
    external_data_tools: backendModelConfig.external_data_tools ?? [],
    system_parameters: backendModelConfig.system_parameters,
    dataSets: nextDataSets,
    agentConfig:
      mode === AppModeEnum.AGENT_CHAT
        ? {
            max_iteration: DEFAULT_AGENT_SETTING.max_iteration,
            ...backendModelConfig.agent_mode,
            enabled: true,
            tools: agentModeTools
              .filter((tool) => !tool.dataset)
              .map((tool) => {
                const toolInCollectionList = collectionList.find(
                  (collection) => collection.id === tool.provider_id,
                )
                return {
                  ...tool,
                  isDeleted:
                    deletedTools?.some(
                      (deletedTool) =>
                        (deletedTool.provider_id || deletedTool.id) === tool.provider_id &&
                        deletedTool.tool_name === tool.tool_name,
                    ) ?? false,
                  notAuthor: toolInCollectionList?.is_team_authorization === false,
                  ...(tool.provider_type === 'builtin'
                    ? {
                        provider_id: correctToolProvider(
                          tool.provider_name,
                          !!toolInCollectionList,
                        ),
                        provider_name: correctToolProvider(
                          tool.provider_name,
                          !!toolInCollectionList,
                        ),
                      }
                    : {}),
                }
              }) as ModelConfig['agentConfig']['tools'],
            strategy: backendModelConfig.agent_mode?.strategy ?? AgentStrategy.react,
          }
        : DEFAULT_AGENT_SETTING,
  }
}

export function buildPublishedConfig({
  backendModelConfig,
  collectionList,
  datasetConfigs,
  deletedTools,
  mode,
  nextDataSets,
}: {
  backendModelConfig: BackendModelConfig
  collectionList: Collection[]
  datasetConfigs: DatasetConfigs
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}): ConfigurationPublishConfig {
  return {
    modelConfig: buildPublishedModelConfig({
      backendModelConfig,
      collectionList,
      deletedTools,
      mode,
      nextDataSets,
    }),
    completionParams: backendModelConfig.model.completion_params,
    promptMode:
      backendModelConfig.prompt_type === PromptMode.advanced
        ? PromptMode.advanced
        : PromptMode.simple,
    chatPromptConfig: normalizeChatPromptConfig(backendModelConfig.chat_prompt_config),
    completionPromptConfig: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    datasetConfigs,
    externalDataToolsConfig: backendModelConfig.external_data_tools ?? [],
  }
}
