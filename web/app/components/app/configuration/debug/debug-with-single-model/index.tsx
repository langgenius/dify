import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react'
import {
  useConfigFromDebugContext,
  useFormattingChangedSubscription,
} from '../hooks'
import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { ChatConfig, ChatItem, OnSend } from '@/app/components/base/chat/types'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchConversationMessages,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useFeatures } from '@/app/components/base/features/hooks'
import { getLastAnswer } from '@/app/components/base/chat/utils'
import type { InputForm } from '@/app/components/base/chat/chat/type'

type DebugWithSingleModelProps = {
  checkCanSend?: () => boolean
}
export type DebugWithSingleModelRefType = {
  handleRestart: () => void
}
const DebugWithSingleModel = forwardRef<DebugWithSingleModelRefType, DebugWithSingleModelProps>(({
  checkCanSend,
}, ref) => {
  const { userProfile } = useAppContext()
  const {
    modelConfig,
    appId,
    inputs,
    collectionList,
    completionParams,
    // isShowVisionConfig,
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
    chatListRef,
    isResponding,
    handleSend,
    suggestedQuestions,
    handleStop,
    handleUpdateChatList,
    handleRestart,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
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

  const doSend: OnSend = useCallback((message, files, last_answer) => {
    if (checkCanSend && !checkCanSend())
      return
    const currentProvider = textGenerationModelList.find(item => item.provider === modelConfig.provider)
    const currentModel = currentProvider?.models.find(model => model.model === modelConfig.model_id)
    const supportVision = currentModel?.features?.includes(ModelFeatureEnum.vision)

    const configData = {
      ...config,
      model: {
        provider: modelConfig.provider,
        name: modelConfig.model_id,
        mode: modelConfig.mode,
        completion_params: completionParams,
      },
    }

    const data: any = {
      query: message,
      inputs,
      model_config: configData,
      parent_message_id: last_answer?.id || getLastAnswer(chatListRef.current)?.id || null,
    }

    if ((config.file_upload as any)?.enabled && files?.length && supportVision)
      data.files = files

    handleSend(
      `apps/${appId}/chat-messages`,
      data,
      {
        onGetConversationMessages: (conversationId, getAbortController) => fetchConversationMessages(appId, conversationId, getAbortController),
        onGetSuggestedQuestions: (responseItemId, getAbortController) => fetchSuggestedQuestions(appId, responseItemId, getAbortController),
      },
    )
  }, [chatListRef, appId, checkCanSend, completionParams, config, handleSend, inputs, modelConfig, textGenerationModelList])

  const doRegenerate = useCallback((chatItem: ChatItem) => {
    const index = chatList.findIndex(item => item.id === chatItem.id)
    if (index === -1)
      return

    const prevMessages = chatList.slice(0, index)
    const question = prevMessages.pop()
    const lastAnswer = getLastAnswer(prevMessages)

    if (!question)
      return

    handleUpdateChatList(prevMessages)
    doSend(question.content, question.message_files, lastAnswer)
  }, [chatList, handleUpdateChatList, doSend])

  const allToolIcons = useMemo(() => {
    const icons: Record<string, any> = {}
    modelConfig.agentConfig.tools?.forEach((item: any) => {
      icons[item.tool_name] = collectionList.find((collection: any) => collection.id === item.provider_id)?.icon
    })
    return icons
  }, [collectionList, modelConfig.agentConfig.tools])

  useImperativeHandle(ref, () => {
    return {
      handleRestart,
    }
  }, [handleRestart])

  const setShowAppConfigureFeaturesModal = useAppStore(s => s.setShowAppConfigureFeaturesModal)

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerClassName='px-3 pt-6'
      chatFooterClassName='px-3 pt-10 pb-0'
      showFeatureBar
      showFileUpload={false}
      onFeatureBarClick={setShowAppConfigureFeaturesModal}
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      inputs={inputs}
      inputsForm={inputsForm}
      onRegenerate={doRegenerate}
      onStopResponding={handleStop}
      showPromptLog
      questionIcon={<Avatar name={userProfile.name} size={40} />}
      allToolIcons={allToolIcons}
      onAnnotationEdited={handleAnnotationEdited}
      onAnnotationAdded={handleAnnotationAdded}
      onAnnotationRemoved={handleAnnotationRemoved}
      noSpacing
    />
  )
})

DebugWithSingleModel.displayName = 'DebugWithSingleModel'

export default memo(DebugWithSingleModel)
