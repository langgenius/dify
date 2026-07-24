import type { FC } from 'react'
import type { ModelAndParameter } from '../types'
import type {
  OnSend,
  TextGenerationConfig,
} from '@/app/components/base/text-generation/types'
import { noop } from 'es-toolkit/function'
import { cloneDeep } from 'es-toolkit/object'
import { memo } from 'react'
import TextGeneration from '@/app/components/app/text-generate/item'
import { TransferMethod } from '@/app/components/base/chat/types'
import { useFeatures } from '@/app/components/base/features/hooks'
import { useTextGeneration } from '@/app/components/base/text-generation/hooks'
import { DEFAULT_CHAT_PROMPT_CONFIG, DEFAULT_COMPLETION_PROMPT_CONFIG } from '@/config'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import { AppSourceType } from '@/service/share'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'

type TextGenerationItemProps = {
  modelAndParameter: ModelAndParameter
}
const TextGenerationItem: FC<TextGenerationItemProps> = ({
  modelAndParameter,
}) => {
  const {
    isAdvancedMode,
    modelConfig,
    appId,
    inputs,
    promptMode,
    speechToTextConfig,
    introduction,
    suggestedQuestionsAfterAnswerConfig,
    citationConfig,
    externalDataToolsConfig,
    chatPromptConfig,
    completionPromptConfig,
    dataSets,
    datasetConfigs,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
  const features = useFeatures(s => s.features)
  const postDatasets = dataSets.map(({ id }) => ({
    dataset: {
      enabled: true,
      id,
    },
  }))
  const contextVar = modelConfig.configs.prompt_variables.find(item => item.is_context_var)?.key
  const config: TextGenerationConfig = {
    pre_prompt: !isAdvancedMode ? modelConfig.configs.prompt_template : '',
    prompt_type: promptMode,
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : cloneDeep(DEFAULT_CHAT_PROMPT_CONFIG),
    completion_prompt_config: isAdvancedMode ? completionPromptConfig : cloneDeep(DEFAULT_COMPLETION_PROMPT_CONFIG),
    user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
    dataset_query_variable: contextVar || '',
    // features
    more_like_this: features.moreLikeThis as any,
    sensitive_word_avoidance: features.moderation as any,
    text_to_speech: features.text2speech as any,
    file_upload: features.file as any,
    opening_statement: introduction,
    speech_to_text: speechToTextConfig,
    suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
    retriever_resource: citationConfig,
    external_data_tools: externalDataToolsConfig,
    agent_mode: {
      enabled: false,
      tools: [],
    },
    dataset_configs: {
      ...datasetConfigs,
      datasets: {
        datasets: [...postDatasets],
      } as any,
    },
    system_parameters: modelConfig.system_parameters,
  }
  const {
    completion,
    handleSend,
    isResponding,
    messageId,
  } = useTextGeneration()

  const doSend: OnSend = (message, files) => {
    const currentProvider = textGenerationModelList.find(item => item.provider === modelAndParameter.provider)
    const currentModel = currentProvider?.models.find(model => model.model === modelAndParameter.model)

    const configData = {
      ...config,
      model: {
        provider: modelAndParameter.provider,
        name: modelAndParameter.model,
        mode: currentModel?.model_properties.mode,
        completion_params: modelAndParameter.parameters,
      },
    }

    const data: any = {
      inputs,
      model_config: configData,
    }

    if ((config.file_upload as any).enabled && files && files?.length > 0) {
      data.files = files.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    handleSend(
      `apps/${appId}/completion-messages`,
      data,
    )
  }

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === APP_CHAT_WITH_MULTIPLE_MODEL)
      doSend(v.payload.message, v.payload.files)
  })

  return (
    <TextGeneration
      appSourceType={AppSourceType.webApp}
      className="flex h-full flex-col overflow-y-auto border-none"
      content={completion}
      isLoading={!completion && isResponding}
      isResponding={isResponding}
      siteInfo={null}
      messageId={messageId}
      isError={false}
      onRetry={noop}
      inSidePanel
    />
  )
}

export default memo(TextGenerationItem)
