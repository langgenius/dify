import type { SelectorTranslate } from '../../utils'
import type { ConfigurationPublishConfig } from './types'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { DataSet } from '@/models/datasets'
import type { DatasetConfigs, ModelConfig, PromptVariable } from '@/models/debug'
import type { ModelConfig as BackendModelConfig } from '@/types/app'
import { clone } from 'es-toolkit/object'
import { produce } from 'immer'
import { toast } from '@/app/components/app/configuration/toast'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { PromptMode } from '@/models/debug'
import { AgentStrategy, AppModeEnum, ModelModeType } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { getStringSelectorTranslate } from '../../utils'
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
  chatPromptConfig: BackendModelConfig['chat_prompt_config']
  completionParams: FormValue
  completionPromptConfig: BackendModelConfig['completion_prompt_config']
  contextVar?: string
  dataSets: DataSet[]
  datasetConfigs: DatasetConfigs
  externalDataToolsConfig: BackendModelConfig['external_data_tools']
  features?: FeaturesData
  isAdvancedMode: boolean
  isFunctionCall: boolean
  modelConfig: ModelConfig
  modelId: string
  modelProvider: string
  promptMode: BackendModelConfig['prompt_type']
  promptVariables: PromptVariable[]
  promptTemplate: string
  resolvedModelModeType: BackendModelConfig['model']['mode']
}): BackendModelConfig {
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
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : clone(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode
      ? completionPromptConfig
      : clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
    user_input_form: promptVariablesToUserInputsForm(promptVariables),
    dataset_query_variable: contextVar || '',
    more_like_this: features?.moreLikeThis as never,
    opening_statement: features?.opening?.enabled ? features.opening?.opening_statement || '' : '',
    suggested_questions: features?.opening?.enabled
      ? features.opening?.suggested_questions || []
      : [],
    sensitive_word_avoidance: features?.moderation as never,
    speech_to_text: features?.speech2text as never,
    text_to_speech: features?.text2speech as never,
    file_upload: fileUpload as never,
    suggested_questions_after_answer: features?.suggested as never,
    retriever_resource: features?.citation as never,
    agent_mode: {
      ...modelConfig.agentConfig,
      strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
    },
    external_data_tools: externalDataToolsConfig,
    model: {
      provider: modelProvider,
      name: modelId,
      mode: resolvedModelModeType,
      completion_params: completionParams as BackendModelConfig['model']['completion_params'],
    },
    dataset_configs: {
      ...datasetConfigs,
      datasets: {
        datasets: [...postDatasets],
      } as never,
    },
    system_parameters: modelConfig.system_parameters,
  }
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
    t: rawTranslate,
  }: {
    appId: string
    chatPromptConfig: BackendModelConfig['chat_prompt_config']
    completionParamsState: FormValue
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
    setPublishedConfig: (config: ConfigurationPublishConfig) => void
    t: SelectorTranslate<'appDebug' | 'common'>
  }) =>
  async (
    updateAppModelConfig: (params: { url: string; body: BackendModelConfig }) => Promise<unknown>,
    modelAndParameter?: { model: string; provider: string; parameters: FormValue },
    features?: FeaturesData,
  ) => {
    const t = getStringSelectorTranslate(rawTranslate)
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

    const body = buildPublishBody({
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

    await updateAppModelConfig({ url: `/apps/${appId}/model-config`, body })
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
      draft.suggested_questions = body.suggested_questions ?? []
      draft.suggested_questions_after_answer = body.suggested_questions_after_answer
      draft.speech_to_text = body.speech_to_text
      draft.text_to_speech = body.text_to_speech
      draft.file_upload = body.file_upload ?? null
      draft.retriever_resource = body.retriever_resource
      draft.sensitive_word_avoidance = body.sensitive_word_avoidance
      draft.external_data_tools = body.external_data_tools
      draft.system_parameters = body.system_parameters
      const publishedAgentConfig = body.agent_mode as ModelConfig['agentConfig']
      draft.agentConfig = {
        ...draft.agentConfig,
        ...publishedAgentConfig,
        max_iteration: publishedAgentConfig.max_iteration || draft.agentConfig.max_iteration,
      }
      draft.dataSets = dataSets
    })

    setPublishedConfig({
      modelConfig: nextModelConfig,
      completionParams: body.model.completion_params,
      promptMode:
        body.prompt_type === PromptMode.advanced ? PromptMode.advanced : PromptMode.simple,
      chatPromptConfig: normalizeChatPromptConfig(body.chat_prompt_config),
      completionPromptConfig: normalizeCompletionPromptConfig(body.completion_prompt_config),
      datasetConfigs: {
        ...datasetConfigs,
        datasets: body.dataset_configs.datasets,
      },
      externalDataToolsConfig: body.external_data_tools ?? [],
    })
    toast.success(t(($) => $['api.success'], { ns: 'common' }))
    setCanReturnToSimpleMode(false)
    return true
  }
