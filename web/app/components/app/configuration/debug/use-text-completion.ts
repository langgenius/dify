import type { ModelConfig as BackendModelConfig, VisionFile } from '@/types/app'
import { useBoolean } from 'ahooks'
import { cloneDeep } from 'es-toolkit/object'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useFeatures } from '@/app/components/base/features/hooks'
import { ToastContext } from '@/app/components/base/toast'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { sendCompletionMessage } from '@/service/debug'
import { TransferMethod } from '@/types/app'
import { formatBooleanInputs, promptVariablesToUserInputsForm } from '@/utils/model-config'

type UseTextCompletionOptions = {
  checkCanSend: () => boolean
  onShowCannotQueryDataset: () => void
}

export const useTextCompletion = ({
  checkCanSend,
  onShowCannotQueryDataset,
}: UseTextCompletionOptions) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const {
    appId,
    isAdvancedMode,
    promptMode,
    chatPromptConfig,
    completionPromptConfig,
    introduction,
    suggestedQuestionsAfterAnswerConfig,
    speechToTextConfig,
    citationConfig,
    dataSets,
    modelConfig,
    completionParams,
    hasSetContextVar,
    datasetConfigs,
    externalDataToolsConfig,
    inputs,
  } = useDebugConfigurationContext()
  const features = useFeatures(s => s.features)

  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  const [completionRes, setCompletionRes] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)
  const [completionFiles, setCompletionFiles] = useState<VisionFile[]>([])

  const sendTextCompletion = useCallback(async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
      return false
    }

    if (dataSets.length > 0 && !hasSetContextVar) {
      onShowCannotQueryDataset()
      return true
    }

    if (!checkCanSend())
      return

    const postDatasets = dataSets.map(({ id }) => ({
      dataset: {
        enabled: true,
        id,
      },
    }))
    const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key

    const postModelConfig: BackendModelConfig = {
      pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
      prompt_type: promptMode,
      chat_prompt_config: isAdvancedMode ? chatPromptConfig : cloneDeep(DEFAULT_CHAT_PROMPT_CONFIG),
      completion_prompt_config: isAdvancedMode ? completionPromptConfig : cloneDeep(DEFAULT_COMPLETION_PROMPT_CONFIG),
      user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
      dataset_query_variable: contextVar || '',
      /* eslint-disable ts/no-explicit-any */
      dataset_configs: {
        ...datasetConfigs,
        datasets: {
          datasets: [...postDatasets],
        } as any,
      },
      agent_mode: {
        enabled: false,
        tools: [],
      },
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams as any,
      },
      more_like_this: features.moreLikeThis as any,
      sensitive_word_avoidance: features.moderation as any,
      text_to_speech: features.text2speech as any,
      file_upload: features.file as any,
      /* eslint-enable ts/no-explicit-any */
      opening_statement: introduction,
      suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
      speech_to_text: speechToTextConfig,
      retriever_resource: citationConfig,
      system_parameters: modelConfig.system_parameters,
      external_data_tools: externalDataToolsConfig,
    }

    // eslint-disable-next-line ts/no-explicit-any
    const data: Record<string, any> = {
      inputs: formatBooleanInputs(modelConfig.configs.prompt_variables, inputs),
      model_config: postModelConfig,
    }

    // eslint-disable-next-line ts/no-explicit-any
    if ((features.file as any).enabled && completionFiles && completionFiles?.length > 0) {
      data.files = completionFiles.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    setCompletionRes('')
    setMessageId('')
    let res: string[] = []

    setRespondingTrue()
    sendCompletionMessage(appId, data, {
      onData: (data: string, _isFirstMessage: boolean, { messageId }) => {
        res.push(data)
        setCompletionRes(res.join(''))
        setMessageId(messageId)
      },
      onMessageReplace: (messageReplace) => {
        res = [messageReplace.answer]
        setCompletionRes(res.join(''))
      },
      onCompleted() {
        setRespondingFalse()
      },
      onError() {
        setRespondingFalse()
      },
    })
  }, [
    appId,
    checkCanSend,
    chatPromptConfig,
    citationConfig,
    completionFiles,
    completionParams,
    completionPromptConfig,
    datasetConfigs,
    dataSets,
    externalDataToolsConfig,
    features,
    hasSetContextVar,
    inputs,
    introduction,
    isAdvancedMode,
    isResponding,
    modelConfig,
    notify,
    onShowCannotQueryDataset,
    promptMode,
    setRespondingFalse,
    setRespondingTrue,
    speechToTextConfig,
    suggestedQuestionsAfterAnswerConfig,
    t,
  ])

  return {
    isResponding,
    completionRes,
    messageId,
    completionFiles,
    setCompletionFiles,
    sendTextCompletion,
  }
}
