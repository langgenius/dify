/* eslint-disable ts/no-explicit-any */
import type { PublishConfig } from '../types'
import type { ModelAndParameter } from '@/app/components/app/configuration/debug/types'
import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  BlockStatus,
  ChatPromptConfig,
  CitationConfig,
  CompletionPromptConfig,
  ModelConfig,
  MoreLikeThisConfig,
  PromptMode,
  SpeechToTextConfig,
  SuggestedQuestionsAfterAnswerConfig,
  TextToSpeechConfig,
} from '@/models/debug'
import type { App } from '@/types/app'
import type { PublishWorkflowParams } from '@/types/workflow'
import { clone } from 'es-toolkit/object'
import { produce } from 'immer'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { updateAppModelConfig } from '@/service/apps'
import { AgentStrategy, AppModeEnum, ModelModeType } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'

type BackendModelConfig = App['model_config']

type UseConfigurationPublishArgs = {
  appId: string
  mode: AppModeEnum
  modelConfig: ModelConfig
  completionParams: FormValue
  promptMode: PromptMode
  isAdvancedMode: boolean
  chatPromptConfig: ChatPromptConfig
  completionPromptConfig: CompletionPromptConfig
  hasSetBlockStatus: BlockStatus
  contextVar: string | undefined
  dataSets: Array<{ id: string }>
  datasetConfigs: BackendModelConfig['dataset_configs']
  introduction: string
  moreLikeThisConfig: MoreLikeThisConfig
  suggestedQuestionsAfterAnswerConfig: SuggestedQuestionsAfterAnswerConfig
  speechToTextConfig: SpeechToTextConfig
  textToSpeechConfig: TextToSpeechConfig
  citationConfig: CitationConfig
  externalDataToolsConfig: NonNullable<BackendModelConfig['external_data_tools']>
  isFunctionCall: boolean
  setPublishedConfig: (config: PublishConfig) => void
  setCanReturnToSimpleMode: (value: boolean) => void
}

export const useConfigurationPublish = ({
  appId,
  mode,
  modelConfig,
  completionParams,
  promptMode,
  isAdvancedMode,
  chatPromptConfig,
  completionPromptConfig,
  hasSetBlockStatus,
  contextVar,
  dataSets,
  datasetConfigs,
  introduction,
  moreLikeThisConfig,
  suggestedQuestionsAfterAnswerConfig,
  speechToTextConfig,
  textToSpeechConfig,
  citationConfig,
  externalDataToolsConfig,
  isFunctionCall,
  setPublishedConfig,
  setCanReturnToSimpleMode,
}: UseConfigurationPublishArgs) => {
  const { t } = useTranslation()

  const promptEmpty = useMemo(() => {
    if (mode !== AppModeEnum.COMPLETION)
      return false

    if (isAdvancedMode) {
      if (modelConfig.mode === ModelModeType.chat)
        return chatPromptConfig.prompt.every(({ text }: { text: string }) => !text)

      return !completionPromptConfig.prompt?.text
    }

    return !modelConfig.configs.prompt_template
  }, [chatPromptConfig.prompt, completionPromptConfig.prompt?.text, isAdvancedMode, mode, modelConfig.configs.prompt_template, modelConfig.mode])

  const cannotPublish = useMemo(() => {
    if (mode !== AppModeEnum.COMPLETION) {
      if (!isAdvancedMode)
        return false

      if (modelConfig.mode === ModelModeType.completion)
        return !hasSetBlockStatus.history || !hasSetBlockStatus.query

      return false
    }

    return promptEmpty
  }, [hasSetBlockStatus.history, hasSetBlockStatus.query, isAdvancedMode, mode, modelConfig.mode, promptEmpty])

  const contextVarEmpty = mode === AppModeEnum.COMPLETION && dataSets.length > 0 && !contextVar

  const onPublish = async (params?: ModelAndParameter | PublishWorkflowParams, features?: FeaturesData) => {
    const modelAndParameter = params && 'model' in params ? params : undefined
    const modelId = modelAndParameter?.model || modelConfig.model_id

    if (promptEmpty) {
      toast.error(t('otherError.promptNoBeEmpty', { ns: 'appDebug' }))
      return
    }

    if (isAdvancedMode && mode !== AppModeEnum.COMPLETION && modelConfig.mode === ModelModeType.completion) {
      if (!hasSetBlockStatus.history) {
        toast.error(t('otherError.historyNoBeEmpty', { ns: 'appDebug' }))
        return
      }
      if (!hasSetBlockStatus.query) {
        toast.error(t('otherError.queryNoBeEmpty', { ns: 'appDebug' }))
        return
      }
    }

    if (contextVarEmpty) {
      toast.error(t('feature.dataSet.queryVariable.contextVarNotEmpty', { ns: 'appDebug' }))
      return
    }

    const postDatasets = dataSets.map(({ id }) => ({
      enabled: true,
      id,
    }))

    const fileUpload = (features?.file
      ? { ...features.file }
      : modelConfig.file_upload) as (FileUpload & { fileUploadConfig?: unknown }) | null
    delete fileUpload?.fileUploadConfig

    const moreLikeThisPayload: BackendModelConfig['more_like_this'] = features?.moreLikeThis
      ? { enabled: !!features.moreLikeThis.enabled }
      : moreLikeThisConfig
    const moderationPayload: BackendModelConfig['sensitive_word_avoidance'] = features?.moderation
      ? { enabled: !!features.moderation.enabled }
      : (modelConfig.sensitive_word_avoidance ?? { enabled: false })
    const speechToTextPayload: BackendModelConfig['speech_to_text'] = features?.speech2text
      ? { enabled: !!features.speech2text.enabled }
      : speechToTextConfig
    const textToSpeechPayload: BackendModelConfig['text_to_speech'] = features?.text2speech
      ? {
          enabled: !!features.text2speech.enabled,
          voice: features.text2speech.voice,
          language: features.text2speech.language,
          autoPlay: features.text2speech.autoPlay,
        }
      : textToSpeechConfig
    const suggestedQuestionsAfterAnswerPayload: BackendModelConfig['suggested_questions_after_answer'] = features?.suggested
      ? { enabled: !!features.suggested.enabled }
      : suggestedQuestionsAfterAnswerConfig
    const citationPayload: BackendModelConfig['retriever_resource'] = features?.citation
      ? { enabled: !!features.citation.enabled }
      : citationConfig

    const payload: BackendModelConfig = {
      pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
      prompt_type: promptMode,
      chat_prompt_config: isAdvancedMode ? chatPromptConfig : clone(DEFAULT_CHAT_PROMPT_CONFIG),
      completion_prompt_config: isAdvancedMode ? completionPromptConfig : clone(DEFAULT_COMPLETION_PROMPT_CONFIG),
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      dataset_query_variable: contextVar || '',
      more_like_this: moreLikeThisPayload,
      opening_statement: features?.opening
        ? (features.opening.enabled ? (features.opening.opening_statement || '') : '')
        : introduction,
      suggested_questions: features?.opening
        ? (features.opening.enabled ? (features.opening.suggested_questions || []) : [])
        : (modelConfig.suggested_questions ?? []),
      sensitive_word_avoidance: moderationPayload,
      speech_to_text: speechToTextPayload,
      text_to_speech: textToSpeechPayload,
      file_upload: fileUpload as BackendModelConfig['file_upload'],
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerPayload,
      retriever_resource: citationPayload,
      agent_mode: {
        ...modelConfig.agentConfig,
        strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
      },
      external_data_tools: externalDataToolsConfig,
      model: {
        provider: modelAndParameter?.provider || modelConfig.provider,
        name: modelId,
        mode: modelConfig.mode,
        completion_params: modelAndParameter?.parameters || completionParams as any,
      },
      dataset_configs: {
        ...datasetConfigs,
        datasets: {
          datasets: [...postDatasets],
        },
      },
      system_parameters: modelConfig.system_parameters,
    }

    await updateAppModelConfig({ url: `/apps/${appId}/model-config`, body: payload })
    const nextPublishedModelConfig: ModelConfig = produce(modelConfig, (draft) => {
      draft.opening_statement = introduction
      draft.more_like_this = moreLikeThisConfig
      draft.suggested_questions_after_answer = suggestedQuestionsAfterAnswerConfig
      draft.speech_to_text = speechToTextConfig
      draft.text_to_speech = textToSpeechConfig
      draft.retriever_resource = citationConfig
      draft.dataSets = dataSets
    })

    setPublishedConfig({
      modelConfig: nextPublishedModelConfig,
      completionParams,
    })
    toast.success(t('api.success', { ns: 'common' }))
    setCanReturnToSimpleMode(false)
    return true
  }

  return {
    cannotPublish,
    contextVarEmpty,
    onPublish,
    promptEmpty,
  }
}
