import {
  useCallback,
  useRef,
  useState,
} from 'react'
import type {
  DebugWithSingleOrMultipleModelConfigs,
  ModelAndParameter,
} from './types'
import { ORCHESTRATE_CHANGED } from './types'
import type {
  ChatConfig,
  ChatItem,
} from '@/app/components/base/chat/types'
import {
  AgentStrategy,
} from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'

export const useDebugWithSingleOrMultipleModel = (appId: string) => {
  const localeDebugWithSingleOrMultipleModelConfigs = localStorage.getItem('app-debug-with-single-or-multiple-models')

  const debugWithSingleOrMultipleModelConfigs = useRef<DebugWithSingleOrMultipleModelConfigs>({})

  if (localeDebugWithSingleOrMultipleModelConfigs) {
    try {
      debugWithSingleOrMultipleModelConfigs.current = JSON.parse(localeDebugWithSingleOrMultipleModelConfigs) || {}
    }
    catch (e) {
      console.error(e)
    }
  }

  const [
    debugWithMultipleModel,
    setDebugWithMultipleModel,
  ] = useState(debugWithSingleOrMultipleModelConfigs.current[appId]?.multiple || false)

  const [
    multipleModelConfigs,
    setMultipleModelConfigs,
  ] = useState(debugWithSingleOrMultipleModelConfigs.current[appId]?.configs || [])

  const handleMultipleModelConfigsChange = useCallback((
    multiple: boolean,
    modelConfigs: ModelAndParameter[],
  ) => {
    const value = {
      multiple,
      configs: modelConfigs,
    }
    debugWithSingleOrMultipleModelConfigs.current[appId] = value
    localStorage.setItem('app-debug-with-single-or-multiple-models', JSON.stringify(debugWithSingleOrMultipleModelConfigs.current))
    setDebugWithMultipleModel(value.multiple)
    setMultipleModelConfigs(value.configs)
  }, [appId])

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
  const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
  const config: ChatConfig = {
    pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
    prompt_type: promptMode,
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : {},
    completion_prompt_config: isAdvancedMode ? completionPromptConfig : {},
    user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
    dataset_query_variable: contextVar || '',
    opening_statement: introduction,
    more_like_this: {
      enabled: false,
    },
    suggested_questions: openingSuggestedQuestions,
    suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
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
        datasets: [...postDatasets],
      } as any,
    },
    file_upload: {
      image: visionConfig,
    },
    annotation_reply: annotationConfig,

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
    } as any)
  }, [eventEmitter])

  return dispatcher
}
export const useFormattingChangedSubscription = (chatList: ChatItem[]) => {
  const {
    formattingChanged,
    setFormattingChanged,
  } = useDebugConfigurationContext()
  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === ORCHESTRATE_CHANGED) {
      if (chatList.some(item => item.isAnswer) && !formattingChanged)
        setFormattingChanged(true)
    }
  })
}
