import type {
  AppModelConfigResponse,
  DeletedTool,
} from '@dify/contracts/api/console/apps/types.gen'
import type { ConfigurationPublishConfig } from './types'
import type { Collection } from '@/app/components/tools/types'
import type { DataSet } from '@/models/datasets'
import type { AnnotationReplyConfig, DatasetConfigs, ModelConfig } from '@/models/debug'
import {
  zAppExternalDataToolPayload,
  zAppProviderAgentToolResponse,
} from '@dify/contracts/api/console/apps/zod.gen'
import { ANNOTATION_DEFAULT, DEFAULT_AGENT_SETTING } from '@/config'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, AppModeEnum } from '@/types/app'
import { correctModelProvider, correctToolProvider } from '@/utils'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import { matchesProviderReference } from '@/utils/provider-reference'
import { normalizeChatPromptConfig, normalizeCompletionPromptConfig } from './prompt-config'

export function buildAnnotationDraft(
  annotation: AppModelConfigResponse['annotation_reply'],
): AnnotationReplyConfig {
  if (!annotation.enabled) {
    return {
      id: '',
      enabled: false,
      score_threshold: ANNOTATION_DEFAULT.score_threshold,
      embedding_model: { embedding_provider_name: '', embedding_model_name: '' },
    }
  }
  return {
    ...annotation,
    embedding_model: {
      ...annotation.embedding_model,
      embedding_provider_name: correctModelProvider(
        annotation.embedding_model.embedding_provider_name,
      ),
    },
  }
}

function buildPublishedModelConfig({
  backendModelConfig,
  collectionList,
  deletedTools,
  mode,
  nextDataSets,
}: {
  backendModelConfig: AppModelConfigResponse
  collectionList: Collection[]
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}): ModelConfig {
  const model = backendModelConfig.model
  const externalDataTools = backendModelConfig.external_data_tools.map((tool) => {
    const { config } = zAppExternalDataToolPayload.parse({ config: tool.config })
    return { ...tool, config: config ?? undefined }
  })
  const image = backendModelConfig.file_upload.image

  return {
    provider: correctModelProvider(model.provider ?? ''),
    model_id: model.name ?? '',
    mode: model.mode ?? '',
    configs: {
      prompt_template: backendModelConfig.pre_prompt ?? '',
      prompt_variables: userInputsFormToPromptVariables(
        [
          ...backendModelConfig.user_input_form,
          ...externalDataTools.map((item) => ({
            external_data_tool: {
              ...item,
              label: item.label ?? '',
              variable: item.variable ?? '',
              required: true,
            },
          })),
        ],
        backendModelConfig.dataset_query_variable ?? undefined,
      ),
    },
    prompt_type: backendModelConfig.prompt_type,
    chat_prompt_config: normalizeChatPromptConfig(backendModelConfig.chat_prompt_config),
    completion_prompt_config: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    more_like_this: backendModelConfig.more_like_this,
    opening_statement: backendModelConfig.opening_statement,
    suggested_questions: backendModelConfig.suggested_questions,
    sensitive_word_avoidance: backendModelConfig.sensitive_word_avoidance,
    speech_to_text: backendModelConfig.speech_to_text,
    text_to_speech: backendModelConfig.text_to_speech,
    file_upload: {
      ...backendModelConfig.file_upload,
      image: image
        ? {
            ...image,
            detail: image.detail ?? undefined,
          }
        : undefined,
    },
    suggested_questions_after_answer: backendModelConfig.suggested_questions_after_answer,
    retriever_resource: backendModelConfig.retriever_resource,
    annotation_reply: buildAnnotationDraft(backendModelConfig.annotation_reply),
    external_data_tools: externalDataTools,
    dataSets: nextDataSets,
    agentConfig:
      mode === AppModeEnum.AGENT_CHAT
        ? {
            ...backendModelConfig.agent_mode,
            enabled: true,
            max_iteration:
              backendModelConfig.agent_mode.max_iteration ?? DEFAULT_AGENT_SETTING.max_iteration,
            tools: (backendModelConfig.agent_mode.tools ?? [])
              .filter((tool) => !tool.dataset)
              .map((tool) => {
                const providerTool = zAppProviderAgentToolResponse.safeParse(tool)
                if (!providerTool.success) return tool
                const current = providerTool.data
                const collection = collectionList.find((item) =>
                  matchesProviderReference(item, current.provider_id),
                )
                return {
                  ...tool,
                  ...current,
                  provider_name: current.provider_name ?? current.provider_id,
                  tool_label: current.tool_label ?? current.tool_name,
                  isDeleted:
                    deletedTools?.some(
                      (deleted) =>
                        deleted.provider_id === current.provider_id &&
                        deleted.tool_name === current.tool_name,
                    ) ?? false,
                  notAuthor: collection?.is_team_authorization === false,
                  ...(current.provider_type === 'builtin'
                    ? {
                        provider_id: correctToolProvider(
                          current.provider_name ?? current.provider_id,
                          !!collection,
                        ),
                        provider_name: correctToolProvider(
                          current.provider_name ?? current.provider_id,
                          !!collection,
                        ),
                      }
                    : {}),
                }
              }),
            strategy:
              backendModelConfig.agent_mode.strategy === 'function_call' ||
              backendModelConfig.agent_mode.strategy === 'function-calling'
                ? AgentStrategy.functionCall
                : AgentStrategy.react,
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
  backendModelConfig: AppModelConfigResponse
  collectionList: Collection[]
  datasetConfigs: DatasetConfigs
  deletedTools?: DeletedTool[]
  mode: AppModeEnum
  nextDataSets: DataSet[]
}): ConfigurationPublishConfig {
  const modelConfig = buildPublishedModelConfig({
    backendModelConfig,
    collectionList,
    deletedTools,
    mode,
    nextDataSets,
  })
  return {
    modelConfig,
    completionParams: backendModelConfig.model.completion_params ?? {},
    promptMode:
      backendModelConfig.prompt_type === PromptMode.advanced
        ? PromptMode.advanced
        : PromptMode.simple,
    chatPromptConfig: normalizeChatPromptConfig(backendModelConfig.chat_prompt_config),
    completionPromptConfig: normalizeCompletionPromptConfig(
      backendModelConfig.completion_prompt_config,
    ),
    datasetConfigs,
    externalDataToolsConfig: modelConfig.external_data_tools ?? [],
  }
}
