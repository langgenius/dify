import type { AppModelConfigPayload } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import type { ConfigurationPublishConfig } from './types'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs, ModelConfig, PromptVariable } from '@/models/debug'
import type { ConsoleClient } from '@/service/console'
import {
  zAppAgentModePayload,
  zAppChatPromptPayload,
  zAppDatasetConfigPayload,
  zAppExternalDataToolPayload,
  zAppFileUploadPayload,
  zAppModelConfigPayload,
  zAppSuggestedQuestionsPayload,
  zAppUserInputFormPayload,
} from '@dify/contracts/api/console/apps/zod.gen'
import { clone } from 'es-toolkit/object'
import { produce } from 'immer'
import { toast } from '@/app/components/app/configuration/toast'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, AppModeEnum, ModelModeType } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { normalizeChatPromptConfig, normalizeCompletionPromptConfig } from './prompt-config'

export function buildPublishBody({
  chatPromptConfig,
  completionParams,
  completionPromptConfig,
  contextVar,
  dataSets,
  datasetConfigs,
  externalDataToolsConfig,
  features,
  isAdvancedMode,
  isFunctionCall,
  modelConfig,
  modelId,
  modelProvider,
  promptMode,
  promptVariables,
  promptTemplate,
  resolvedModelModeType,
}: {
  chatPromptConfig: ModelConfig['chat_prompt_config']
  completionParams: FormValue
  completionPromptConfig: ModelConfig['completion_prompt_config']
  contextVar?: string
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: ModelConfig['external_data_tools']
  features?: FeaturesData
  isAdvancedMode: boolean
  isFunctionCall: boolean
  modelConfig: ModelConfig
  modelId: string
  modelProvider: string
  promptMode: PromptMode
  promptVariables: PromptVariable[]
  promptTemplate: string
  resolvedModelModeType: ModelModeType
}) {
  const postDatasets = dataSets.map(({ id }) => ({
    dataset: {
      enabled: true,
      id,
    },
  }))
  const fileUpload = { ...features?.file }
  delete fileUpload?.fileUploadConfig

  return {
    pre_prompt: !isAdvancedMode ? promptTemplate : '',
    prompt_type: promptMode,
    chat_prompt_config: isAdvancedMode
      ? zAppChatPromptPayload.nullish().parse(chatPromptConfig)
      : clone(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode
      ? completionPromptConfig
      : clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
    user_input_form: zAppUserInputFormPayload
      .array()
      .parse(promptVariablesToUserInputsForm(promptVariables)),
    dataset_query_variable: contextVar || '',
    more_like_this: features?.moreLikeThis,
    opening_statement: features?.opening?.enabled ? features.opening?.opening_statement || '' : '',
    suggested_questions: features?.opening?.enabled
      ? features.opening?.suggested_questions || []
      : [],
    sensitive_word_avoidance: features?.moderation,
    speech_to_text: features?.speech2text,
    text_to_speech: features?.text2speech,
    file_upload: zAppFileUploadPayload.parse(fileUpload),
    suggested_questions_after_answer: features?.suggested
      ? zAppSuggestedQuestionsPayload.parse(features.suggested)
      : undefined,
    retriever_resource: features?.citation,
    agent_mode: zAppAgentModePayload.parse({
      ...modelConfig.agentConfig,
      strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
    }),
    external_data_tools: externalDataToolsConfig
      ? zAppExternalDataToolPayload.array().parse(externalDataToolsConfig)
      : externalDataToolsConfig,
    model: {
      provider: modelProvider,
      name: modelId,
      mode: resolvedModelModeType,
      completion_params: completionParams,
    },
    dataset_configs: zAppDatasetConfigPayload.parse({
      ...datasetConfigs,
      datasets: { datasets: postDatasets },
    }),
  } satisfies AppModelConfigPayload
}

export const createPublishHandler =
  ({
    appId,
    chatPromptConfig,
    completionParamsState,
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
    t,
  }: {
    appId: string
    chatPromptConfig: ModelConfig['chat_prompt_config']
    completionParamsState: FormValue
    completionPromptConfig: ModelConfig['completion_prompt_config']
    contextVar?: string
    contextVarEmpty: boolean
    dataSets: DataSet[]
    datasetConfigs: DatasetConfigs
    externalDataToolsConfig: ModelConfig['external_data_tools']
    hasSetBlockStatus: { history: boolean; query: boolean }
    isAdvancedMode: boolean
    isFunctionCall: boolean
    mode: AppModeEnum
    modelConfig: ModelConfig
    promptEmpty: boolean
    promptMode: PromptMode
    resolvedModelModeType: ModelModeType
    setCanReturnToSimpleMode: (value: boolean) => void
    setPublishedConfig: (config: ConfigurationPublishConfig) => void
    t: TFunction<['appDebug', 'common']>
  }) =>
  async (
    updateAppModelConfig: (
      params: Parameters<ConsoleClient['apps']['byAppId']['modelConfig']['post']>[0],
    ) => Promise<unknown>,
    modelAndParameter?: { model: string; provider: string; parameters: FormValue },
    features?: FeaturesData,
  ) => {
    const modelId = modelAndParameter?.model || modelConfig.model_id
    const promptTemplate = modelConfig.configs.prompt_template
    const promptVariables = modelConfig.configs.prompt_variables

    if (promptEmpty) {
      toast.error(t(($) => $['otherError.promptNoBeEmpty'], { ns: 'appDebug' }))
      return
    }
    if (
      isAdvancedMode &&
      mode !== AppModeEnum.COMPLETION &&
      resolvedModelModeType === ModelModeType.completion
    ) {
      if (!hasSetBlockStatus.history) {
        toast.error(t(($) => $['otherError.historyNoBeEmpty'], { ns: 'appDebug' }))
        return
      }
      if (!hasSetBlockStatus.query) {
        toast.error(t(($) => $['otherError.queryNoBeEmpty'], { ns: 'appDebug' }))
        return
      }
    }
    if (contextVarEmpty) {
      toast.error(
        t(($) => $['feature.dataSet.queryVariable.contextVarNotEmpty'], { ns: 'appDebug' }),
      )
      return
    }

    let body: ReturnType<typeof buildPublishBody>
    try {
      body = buildPublishBody({
        chatPromptConfig,
        completionParams: modelAndParameter?.parameters || completionParamsState,
        completionPromptConfig,
        contextVar,
        dataSets,
        datasetConfigs,
        externalDataToolsConfig,
        features,
        isAdvancedMode,
        isFunctionCall,
        modelConfig,
        modelId,
        modelProvider: modelAndParameter?.provider || modelConfig.provider,
        promptMode,
        promptTemplate,
        promptVariables,
        resolvedModelModeType,
      })
    } catch (error) {
      toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      throw error
    }

    const nextModelConfig = produce(modelConfig, (draft: ModelConfig) => {
      draft.provider = body.model.provider
      draft.model_id = body.model.name
      draft.mode = body.model.mode
      draft.configs.prompt_template = body.pre_prompt
      draft.prompt_type = body.prompt_type
      draft.chat_prompt_config = normalizeChatPromptConfig(body.chat_prompt_config)
      draft.completion_prompt_config = normalizeCompletionPromptConfig(
        body.completion_prompt_config,
      )
      draft.opening_statement = body.opening_statement
      draft.more_like_this = body.more_like_this
        ? { ...body.more_like_this, enabled: body.more_like_this.enabled ?? false }
        : null
      draft.suggested_questions = body.suggested_questions ?? []
      draft.suggested_questions_after_answer = features?.suggested
        ? { ...features.suggested, enabled: features.suggested.enabled ?? false }
        : null
      draft.speech_to_text = body.speech_to_text
        ? { ...body.speech_to_text, enabled: body.speech_to_text.enabled ?? false }
        : null
      draft.text_to_speech = body.text_to_speech
        ? { ...body.text_to_speech, enabled: body.text_to_speech.enabled ?? false }
        : null
      draft.file_upload = features?.file ? { ...features.file, fileUploadConfig: undefined } : null
      draft.retriever_resource = body.retriever_resource
        ? { ...body.retriever_resource, enabled: body.retriever_resource.enabled ?? false }
        : null
      draft.sensitive_word_avoidance = body.sensitive_word_avoidance
        ? {
            ...body.sensitive_word_avoidance,
            enabled: body.sensitive_word_avoidance.enabled ?? false,
          }
        : null
      draft.external_data_tools = externalDataToolsConfig
      draft.agentConfig = {
        ...draft.agentConfig,
        strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
      }
      draft.dataSets = dataSets
    })

    const publishedSnapshot: ConfigurationPublishConfig = {
      modelConfig: nextModelConfig,
      completionParams: body.model.completion_params,
      promptMode:
        body.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple,
      chatPromptConfig: normalizeChatPromptConfig(body.chat_prompt_config),
      completionPromptConfig: normalizeCompletionPromptConfig(body.completion_prompt_config),
      datasetConfigs: {
        ...datasetConfigs,
        datasets: { datasets: dataSets.map(({ id }) => ({ enabled: true, id })) },
      },
      externalDataToolsConfig: externalDataToolsConfig ?? [],
    }

    await updateAppModelConfig({
      params: { app_id: appId },
      body: zAppModelConfigPayload.parse(body),
    })
    setPublishedConfig(publishedSnapshot)
    toast.success(t(($) => $['api.success'], { ns: 'common' }))
    setCanReturnToSimpleMode(false)
    return true
  }
