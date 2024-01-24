import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import type { ModelAndParameter } from '../types'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from '../types'
import {
  AgentStrategy,
  ModelModeType,
} from '@/types/app'
import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type {
  ChatConfig,
  OnSend,
} from '@/app/components/base/chat/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchConvesationMessages,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import { promptVariablesToUserInputsForm } from '@/utils/model-config'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

type ChatItemProps = {
  modelAndParameter: ModelAndParameter
}
const ChatItem: FC<ChatItemProps> = ({
  modelAndParameter,
}) => {
  const { userProfile } = useAppContext()
  const {
    isAdvancedMode,
    modelConfig,
    appId,
    inputs,
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
    collectionList,
    textToSpeechConfig,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
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
      strategy: (modelAndParameter.provider === 'openai' && modelConfig.mode === ModelModeType.chat) ? AgentStrategy.functionCall : AgentStrategy.react,
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
  }
  const {
    chatList,
    isResponsing,
    handleSend,
    suggestedQuestions,
    handleRestart,
  } = useChat(
    config,
    {
      inputs,
      promptVariables: modelConfig.configs.prompt_variables,
    },
    [],
    taskId => stopChatMessageResponding(appId, taskId),
  )

  const doSend: OnSend = (message, files) => {
    const currentProvider = textGenerationModelList.find(item => item.provider === modelAndParameter.provider)
    const currentModel = currentProvider?.models.find(model => model.model === modelAndParameter.model)
    const supportVision = currentModel?.features?.includes(ModelFeatureEnum.vision)

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
      query: message,
      inputs,
      model_config: configData,
    }

    if (visionConfig.enabled && files?.length && supportVision)
      data.files = files

    handleSend(
      `apps/${appId}/chat-messages`,
      data,
      {
        onGetConvesationMessages: (conversationId, getAbortController) => fetchConvesationMessages(appId, conversationId, getAbortController),
        onGetSuggestedQuestions: (responseItemId, getAbortController) => fetchSuggestedQuestions(appId, responseItemId, getAbortController),
      },
    )
  }

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === APP_CHAT_WITH_MULTIPLE_MODEL)
      doSend(v.payload.message, v.payload.files)
    if (v.type === APP_CHAT_WITH_MULTIPLE_MODEL_RESTART)
      handleRestart()
  })

  const allToolIcons = useMemo(() => {
    const icons: Record<string, any> = {}
    modelConfig.agentConfig.tools?.forEach((item: any) => {
      icons[item.tool_name] = collectionList.find((collection: any) => collection.id === item.provider_id)?.icon
    })
    return icons
  }, [collectionList, modelConfig.agentConfig.tools])

  if (!chatList.length)
    return null

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponsing={isResponsing}
      noChatInput
      chatContainerclassName='p-4'
      chatFooterClassName='!-bottom-4'
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      showPromptLog
      questionIcon={<Avatar name={userProfile.name} size={40} />}
      allToolIcons={allToolIcons}
    />
  )
}

export default memo(ChatItem)
