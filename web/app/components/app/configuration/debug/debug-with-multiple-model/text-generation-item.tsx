import type { FC } from 'react'
import { memo } from 'react'
import type { ModelAndParameter } from '../types'
import { APP_CHAT_WITH_MULTIPLE_MODEL } from '../types'
import type {
  OnSend,
  TextGenerationConfig,
} from '@/app/components/base/text-generation/types'
import { useTextGeneration } from '@/app/components/base/text-generation/hooks'
import TextGeneration from '@/app/components/app/text-generate/item'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import { TransferMethod } from '@/app/components/base/chat/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'

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
    moderationConfig,
    externalDataToolsConfig,
    chatPromptConfig,
    completionPromptConfig,
    dataSets,
    datasetConfigs,
    visionConfig,
    moreLikeThisConfig,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
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
    chat_prompt_config: isAdvancedMode ? chatPromptConfig : {},
    completion_prompt_config: isAdvancedMode ? completionPromptConfig : {},
    user_input_form: promptVariablesToUserInputsForm(modelConfig.configs.prompt_variables),
    dataset_query_variable: contextVar || '',
    opening_statement: introduction,
    suggested_questions_after_answer: suggestedQuestionsAfterAnswerConfig,
    speech_to_text: speechToTextConfig,
    retriever_resource: citationConfig,
    sensitive_word_avoidance: moderationConfig,
    external_data_tools: externalDataToolsConfig,
    more_like_this: moreLikeThisConfig,
    text_to_speech: {
      enabled: false,
      voice: '',
      language: '',
    },
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
    file_upload: {
      image: visionConfig,
    },
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

    if (visionConfig.enabled && files && files?.length > 0) {
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

  const varList = modelConfig.configs.prompt_variables.map((item: any) => {
    return {
      label: item.key,
      value: inputs[item.key],
    }
  })

  return (
    <TextGeneration
      className='flex flex-col h-full overflow-y-auto border-none'
      innerClassName='grow flex flex-col'
      contentClassName='grow'
      content={completion}
      isLoading={!completion && isResponding}
      isResponding={isResponding}
      isInstalledApp={false}
      messageId={messageId}
      isError={false}
      onRetry={() => { }}
      appId={appId}
      varList={varList}
    />
  )
}

export default memo(TextGenerationItem)
