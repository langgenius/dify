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
import type { ChatItem, OnSend } from '@/app/components/base/chat/types'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchConversationMessages,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import Avatar from '@/app/components/base/avatar'
import { useAppContext } from '@/context/app-context'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

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
    visionConfig,
    collectionList,
    completionParams,
  } = useDebugConfigurationContext()
  const { textGenerationModelList } = useProviderContext()
  const config = useConfigFromDebugContext()
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
      promptVariables: modelConfig.configs.prompt_variables,
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

    const lastAnswer = chatListRef.current.at(-1)

    const data: any = {
      query: message,
      inputs,
      model_config: configData,
      parent_message_id: last_answer?.id || (lastAnswer
        ? lastAnswer.isOpeningStatement
          ? null
          : lastAnswer.id
        : null),
    }

    if (visionConfig.enabled && files?.length && supportVision)
      data.files = files

    handleSend(
      `apps/${appId}/chat-messages`,
      data,
      {
        onGetConversationMessages: (conversationId, getAbortController) => fetchConversationMessages(appId, conversationId, getAbortController),
        onGetSuggestedQuestions: (responseItemId, getAbortController) => fetchSuggestedQuestions(appId, responseItemId, getAbortController),
      },
    )
  }, [chatListRef, appId, checkCanSend, completionParams, config, handleSend, inputs, modelConfig, textGenerationModelList, visionConfig.enabled])

  const doRegenerate = useCallback((chatItem: ChatItem) => {
    const index = chatList.findIndex(item => item.id === chatItem.id)
    if (index === -1)
      return

    const prevMessages = chatList.slice(0, index)
    const question = prevMessages.pop()
    const lastAnswer = prevMessages.at(-1)

    if (!question)
      return

    handleUpdateChatList(prevMessages)
    doSend(question.content, question.message_files, (!lastAnswer || lastAnswer.isOpeningStatement) ? undefined : lastAnswer)
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

  return (
    <Chat
      config={config}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerClassName='p-6'
      chatFooterClassName='px-6 pt-10 pb-4'
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
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
