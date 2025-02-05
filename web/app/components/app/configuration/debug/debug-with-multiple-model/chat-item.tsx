import type { FC } from 'react'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import type { ModelAndParameter } from '../types'
import {
  APP_CHAT_WITH_MULTIPLE_MODEL,
  APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
} from '../types'
import {
  useConfigFromDebugContext,
  useFormattingChangedSubscription,
} from '../hooks'
import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { ChatConfig, OnSend } from '@/app/components/base/chat/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchConversationMessages,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useFeatures } from '@/app/components/base/features/hooks'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import { getLastAnswer } from '@/app/components/base/chat/utils'

type ChatItemProps = {
  modelAndParameter: ModelAndParameter
}
const ChatItem: FC<ChatItemProps> = ({
  modelAndParameter,
}) => {
  const { userProfile } = useAppContext()
  const {
    modelConfig,
    appId,
    inputs,
    collectionList,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
  const features = useFeatures(s => s.features)
  const configTemplate = useConfigFromDebugContext()
  const config = useMemo(() => {
    return {
      ...configTemplate,
      more_like_this: features.moreLikeThis,
      opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
      suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
      sensitive_word_avoidance: features.moderation,
      speech_to_text: features.speech2text,
      text_to_speech: features.text2speech,
      file_upload: features.file,
      suggested_questions_after_answer: features.suggested,
      retriever_resource: features.citation,
      annotation_reply: features.annotationReply,
    } as ChatConfig
  }, [configTemplate, features])
  const inputsForm = useMemo(() => {
    return modelConfig.configs.prompt_variables.filter(item => item.type !== 'api').map(item => ({ ...item, label: item.name, variable: item.key })) as InputForm[]
  }, [modelConfig.configs.prompt_variables])
  const {
    chatList,
    isResponding,
    handleSend,
    suggestedQuestions,
    handleRestart,
  } = useChat(
    config,
    {
      inputs,
      inputsForm,
    },
    [],
    taskId => stopChatMessageResponding(appId, taskId),
  )
  useFormattingChangedSubscription(chatList)

  const doSend: OnSend = useCallback((message, files) => {
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
      parent_message_id: getLastAnswer(chatList)?.id || null,
    }

    if ((config.file_upload as any).enabled && files?.length && supportVision)
      data.files = files

    handleSend(
      `apps/${appId}/chat-messages`,
      data,
      {
        onGetConversationMessages: (conversationId, getAbortController) => fetchConversationMessages(appId, conversationId, getAbortController),
        onGetSuggestedQuestions: (responseItemId, getAbortController) => fetchSuggestedQuestions(appId, responseItemId, getAbortController),
      },
    )
  }, [appId, chatList, config, handleSend, inputs, modelAndParameter.model, modelAndParameter.parameters, modelAndParameter.provider, textGenerationModelList])

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
      isResponding={isResponding}
      noChatInput
      noStopResponding
      chatContainerClassName='p-4'
      chatFooterClassName='p-4 pb-0'
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      showPromptLog
      questionIcon={<Avatar avatar={userProfile.avatar_url} name={userProfile.name} size={40} />}
      allToolIcons={allToolIcons}
      hideLogModal
      noSpacing
    />
  )
}

export default memo(ChatItem)
