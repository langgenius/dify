import type { ModelAndParameter } from './types'
import type { ChatConfig, ChatItem } from '@/app/components/base/chat/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { cloneDeep } from 'es-toolkit/object'
import { useCallback } from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { AgentStrategy } from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { useDebugWithSingleOrMultipleModelConfigs } from './storage'
import { ORCHESTRATE_CHANGED } from './types'

const EMPTY_MODEL_CONFIGS: ModelAndParameter[] = []

export const useDebugWithSingleOrMultipleModel = (appId: string) => {
  const [
    debugWithSingleOrMultipleModelConfigs,
    setDebugWithSingleOrMultipleModelConfigs,
  ] = useDebugWithSingleOrMultipleModelConfigs()

  const appDebugConfig = debugWithSingleOrMultipleModelConfigs[appId]
  const debugWithMultipleModel = appDebugConfig?.multiple ?? false
  const multipleModelConfigs = appDebugConfig?.configs ?? EMPTY_MODEL_CONFIGS

  const handleMultipleModelConfigsChange = useCallback(
    (multiple: boolean, modelConfigs: ModelAndParameter[]) => {
      const value = {
        multiple,
        configs: modelConfigs,
      }
      setDebugWithSingleOrMultipleModelConfigs(configs => ({
        ...(configs ?? {}),
        [appId]: value,
      }))
    },
    [appId, setDebugWithSingleOrMultipleModelConfigs],
  )

  return {
    debugWithMultipleModel,
    multipleModelConfigs,
    handleMultipleModelConfigsChange,
  }
}

export const useConfigFromDebugContext = () => {
  const {
    isAdvancedMode,
    modelConfig,
    appId,
    promptMode,
    speechToTextConfig,
    introduction,
    suggestedQuestions: openingSuggestedQuestions,
    suggestedQuestionsAfterAnswerConfig,
    citationConfig,
    moderationConfig,
    chatPromptConfig,
    completionPromptConfig,
    dataSets,
    datasetConfigs,
    visionConfig,
    annotationConfig,
    textToSpeechConfig,
    isFunctionCall,
  } = useDebugConfigurationContext()
  const postDatasets = dataSets.map(({ id }) => ({
    dataset: {
      enabled: true,
      id,
    },
  }))
  const contextVar = modelConfig.configs.prompt_variables.find((item) => item.is_context_var)?.key
  const config: ChatConfig = {
    pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
    prompt_type: promptMode,
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : cloneDeep(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode
      ? completionPromptConfig
      : cloneDeep(DEFAULT_COMPLETION_PROMPT_CONFIG),
    user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
    dataset_query_variable: contextVar || '',
    opening_statement: introduction,
    more_like_this: modelConfig.more_like_this ?? { enabled: false },
    suggested_questions: openingSuggestedQuestions,
    suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig ?? { enabled: false },
    text_to_speech: textToSpeechConfig,
    speech_to_text: speechToTextConfig,
    retriever_resource: citationConfig,
    sensitive_word_avoidance: moderationConfig,
    agent_mode: {
      ...modelConfig.agentConfig,
      strategy: isFunctionCall ? AgentStrategy.functionCall : AgentStrategy.react,
    },
    dataset_configs: {
      ...datasetConfigs,
      datasets: {
        datasets: [...postDatasets] as unknown as ChatConfig['dataset_configs']['datasets']['datasets'],
      },
    },
    file_upload: {
      image: visionConfig,
      allowed_file_upload_methods: visionConfig.transfer_methods ?? [],
      allowed_file_types: [SupportUploadFileTypes.image],
      max_length: visionConfig.number_limits ?? 0,
      number_limits: visionConfig.number_limits,
    },
    annotation_reply: annotationConfig,
    system_parameters: modelConfig.system_parameters,

    supportAnnotation: true,
    appId,
    supportCitationHitInfo: true,
  }

  return config
}

export const useFormattingChangedDispatcher = () => {
  const { eventEmitter } = useEventEmitterContextContext()

  const dispatcher = useCallback(() => {
    eventEmitter?.emit({
      type: ORCHESTRATE_CHANGED,
    })
  }, [eventEmitter])

  return dispatcher
}
export const useFormattingChangedSubscription = (chatList: ChatItem[]) => {
  const { formattingChanged, setFormattingChanged } = useDebugConfigurationContext()
  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: EventEmitterValue) => {
    if (typeof v !== 'string' && v.type === ORCHESTRATE_CHANGED) {
      if (chatList.some(item => item.isAnswer) && !formattingChanged)
        setFormattingChanged(true)
    }
  })
}
