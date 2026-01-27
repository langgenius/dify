import type {
  DebugWithSingleOrMultipleModelConfigs,
  ModelAndParameter,
} from './types'
import type {
  ChatConfig,
  ChatItem,
} from '@/app/components/base/chat/types'
import type { VisionFile } from '@/types/app'
import { cloneDeep } from 'es-toolkit/object'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import {
  AgentStrategy,
  AppModeEnum,
  ModelModeType,
  TransferMethod,
} from '@/types/app'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { ORCHESTRATE_CHANGED } from './types'

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
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : cloneDeep(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode ? completionPromptConfig : cloneDeep(DEFAULT_COMPLETION_PROMPT_CONFIG),
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
        datasets: [...postDatasets],
      } as any,
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

export const useInputValidation = () => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const {
    isAdvancedMode,
    mode,
    modelModeType,
    hasSetBlockStatus,
    modelConfig,
  } = useDebugConfigurationContext()

  const logError = useCallback((message: string) => {
    notify({ type: 'error', message })
  }, [notify])

  const checkCanSend = useCallback((inputs: Record<string, unknown>, completionFiles: VisionFile[]) => {
    if (isAdvancedMode && mode !== AppModeEnum.COMPLETION) {
      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history) {
          notify({ type: 'error', message: t('otherError.historyNoBeEmpty', { ns: 'appDebug' }) })
          return false
        }
        if (!hasSetBlockStatus.query) {
          notify({ type: 'error', message: t('otherError.queryNoBeEmpty', { ns: 'appDebug' }) })
          return false
        }
      }
    }
    let hasEmptyInput = ''
    const requiredVars = modelConfig.configs.prompt_variables.filter(({ key, name, required, type }) => {
      if (type !== 'string' && type !== 'paragraph' && type !== 'select' && type !== 'number')
        return false
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    })
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('errorMessage.valueOfVarRequired', { ns: 'appDebug', key: hasEmptyInput }))
      return false
    }

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }) })
      return false
    }
    return !hasEmptyInput
  }, [
    hasSetBlockStatus.history,
    hasSetBlockStatus.query,
    isAdvancedMode,
    mode,
    modelConfig.configs.prompt_variables,
    t,
    logError,
    notify,
    modelModeType,
  ])

  return { checkCanSend, logError }
}

export const useFormattingChangeConfirm = () => {
  const [isShowFormattingChangeConfirm, setIsShowFormattingChangeConfirm] = useState(false)
  const { formattingChanged, setFormattingChanged } = useDebugConfigurationContext()

  useEffect(() => {
    if (formattingChanged)
      setIsShowFormattingChangeConfirm(true) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
  }, [formattingChanged])

  const handleConfirm = useCallback((onClear: () => void) => {
    onClear()
    setIsShowFormattingChangeConfirm(false)
    setFormattingChanged(false)
  }, [setFormattingChanged])

  const handleCancel = useCallback(() => {
    setIsShowFormattingChangeConfirm(false)
    setFormattingChanged(false)
  }, [setFormattingChanged])

  return {
    isShowFormattingChangeConfirm,
    handleConfirm,
    handleCancel,
  }
}

export const useModalWidth = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (containerRef.current) {
      const calculatedWidth = document.body.clientWidth - (containerRef.current.clientWidth + 16) - 8
      setWidth(calculatedWidth) // eslint-disable-line react-hooks-extra/no-direct-set-state-in-use-effect
    }
  }, [containerRef])

  return width
}
