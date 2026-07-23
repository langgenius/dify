'use client'

import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { Ref } from 'react'
import type { AgentPreviewChatConfig } from './chat-config'
import type { AnswerActionPosition } from '@/app/components/base/chat/chat/answer/operation'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItem, ChatItemInTree, OnSend } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { SpeechToTextTarget } from '@/app/components/base/voice-input/types'
import type { AgentComposerModel } from '@/features/agent-v2/agent-composer/form-state'
import type { Inputs } from '@/models/debug'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { AgentRosterResponseContent } from '@/app/components/base/chat/chat/answer/agent-roster-response-content'
import { useChat } from '@/app/components/base/chat/chat/hooks'
import { getLastAnswer, isValidGeneratedAnswer } from '@/app/components/base/chat/utils'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { userProfileAtom } from '@/context/account-state'
import dynamic from '@/next/dynamic'
import { consoleClient, consoleQuery } from '@/service/client'
import { buildChatConfig, getAgentSoulInputs, getAgentSoulInputsForm } from './chat-config'

const Chat = dynamic(() => import('@/app/components/base/chat/chat'), { ssr: false })

const stopAgentChatMessageResponding = (agentId: string, taskId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.byTaskId.stop.post({
    params: {
      agent_id: agentId,
      task_id: taskId,
    },
  })
}

const fetchAgentSuggestedQuestions = (agentId: string, messageId: string) => {
  return consoleClient.agent.byAgentId.chatMessages.byMessageId.suggestedQuestions.get({
    params: {
      agent_id: agentId,
      message_id: messageId,
    },
  })
}

type AgentChatHandleSend = ReturnType<typeof useChat>['handleSend']

export type AgentChatMessageRequest = {
  agentId: string
  callbacks: Parameters<AgentChatHandleSend>[2]
  data: Parameters<AgentChatHandleSend>[1]
  handleSend: AgentChatHandleSend
}

export type AgentChatMessageSender = (
  request: AgentChatMessageRequest,
) => ReturnType<AgentChatHandleSend>

export type AgentPreviewChatRuntimeState = {
  isEmptyChat: boolean
  isResponding: boolean
  isSendPending: boolean
}

export type AgentPreviewChatController = {
  send: OnSend
  stop: () => void
}

export function AgentPreviewChatConversation({
  ref,
  agentId,
  answerActionPosition,
  agentSoulConfig,
  clearChatList,
  config,
  conversationId,
  currentModel,
  draftType,
  initialChatTree,
  inputs,
  inputsForm,
  sendButtonLabel,
  sendMessage,
  speechToTextTarget,
  onBeforeSpeechToText,
  onClearChatListChange,
  onConversationComplete,
  onConversationIdChange,
  onCurrentSessionConversationIdChange,
  onRuntimeStateChange,
  onSaveDraftBeforeRun,
  onSendInterrupted,
}: {
  ref: Ref<AgentPreviewChatController>
  agentId: string
  answerActionPosition?: AnswerActionPosition
  agentSoulConfig?: AgentSoulConfig
  clearChatList: boolean
  config: AgentPreviewChatConfig
  conversationId?: string | null
  currentModel?: AgentComposerModel
  draftType?: 'debug_build'
  initialChatTree: ChatItemInTree[]
  inputs: Inputs
  inputsForm: InputForm[]
  sendButtonLabel?: string
  sendMessage: AgentChatMessageSender
  speechToTextTarget: SpeechToTextTarget
  onBeforeSpeechToText?: () => Promise<unknown>
  onClearChatListChange: (clearChatList: boolean) => void
  onConversationComplete?: (conversationId: string, workflowRunId?: string) => void
  onConversationIdChange?: (conversationId: string) => void
  onCurrentSessionConversationIdChange: (conversationId: string) => void
  onRuntimeStateChange: (state: AgentPreviewChatRuntimeState) => void
  onSaveDraftBeforeRun?: () => Promise<AgentSoulConfig | void>
  onSendInterrupted?: () => void
}) {
  const queryClient = useQueryClient()
  const userProfile = useAtomValue(userProfileAtom)
  const sendInterruptedRef = useRef(false)
  const [isSendPending, setIsSendPending] = useState(false)
  const notifySendInterrupted = useCallback(() => {
    if (sendInterruptedRef.current) return

    sendInterruptedRef.current = true
    onSendInterrupted?.()
  }, [onSendInterrupted])
  const { textGenerationModelList } =
    useTextGenerationCurrentProviderAndModelAndModelList(currentModel)
  const {
    chatList,
    setTargetMessageId,
    isResponding,
    handleSend,
    suggestedQuestions,
    handleStop,
    handleAnnotationAdded,
    handleAnnotationEdited,
    handleAnnotationRemoved,
  } = useChat(
    config,
    {
      inputs,
      inputsForm,
    },
    initialChatTree,
    (taskId) => {
      void stopAgentChatMessageResponding(agentId, taskId)
    },
    clearChatList,
    onClearChatListChange,
    conversationId ?? undefined,
    { isNewAgent: true },
  )

  const doSend: OnSend = useCallback(
    async (message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
      sendInterruptedRef.current = false
      setIsSendPending(true)
      let sendStarted = false

      try {
        const preparedAgentSoulConfig = await onSaveDraftBeforeRun?.()
        const runtimeAgentSoulConfig = preparedAgentSoulConfig || agentSoulConfig
        const runtimeInputsForm = preparedAgentSoulConfig
          ? getAgentSoulInputsForm(runtimeAgentSoulConfig)
          : inputsForm
        const runtimeInputs = preparedAgentSoulConfig
          ? getAgentSoulInputs(runtimeInputsForm)
          : inputs
        const runtimeConfig = preparedAgentSoulConfig
          ? buildChatConfig({
              agentSoulConfig: runtimeAgentSoulConfig,
              currentModel: undefined,
              prompt: runtimeAgentSoulConfig?.prompt?.system_prompt ?? '',
            })
          : config

        const currentProvider = textGenerationModelList.find(
          (item) => item.provider === runtimeConfig.model.provider,
        )
        const selectedModel = currentProvider?.models.find(
          (model) => model.model === runtimeConfig.model.name,
        )
        const supportVision = selectedModel?.features?.includes(ModelFeatureEnum.vision)
        const data: Record<string, unknown> = {
          query: message,
          inputs: runtimeInputs,
          overrideInputsForm: runtimeInputsForm,
          parent_message_id:
            (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || null,
        }
        if (draftType) data.draft_type = draftType

        if (files?.length && supportVision) data.files = files

        sendMessage({
          agentId,
          data: data as Parameters<typeof handleSend>[1],
          handleSend,
          callbacks: {
            onGetConversationMessages: async (conversationId) => {
              return queryClient.fetchQuery({
                ...consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
                  input: {
                    params: {
                      agent_id: agentId,
                    },
                    query: {
                      conversation_id: conversationId,
                    },
                  },
                }),
                staleTime: 0,
              })
            },
            onGetSuggestedQuestions: (responseItemId) =>
              fetchAgentSuggestedQuestions(agentId, responseItemId),
            onUnhandledEvent: (event) => {
              if (event.event !== 'error' || typeof event.message !== 'string') return

              return {
                conversationId:
                  typeof event.conversation_id === 'string' ? event.conversation_id : undefined,
                messageId: typeof event.message_id === 'string' ? event.message_id : undefined,
                errorMessage: event.message,
                errorCode: typeof event.code === 'string' ? event.code : undefined,
              }
            },
            onConversationComplete: (completedConversationId, workflowRunId) => {
              if (completedConversationId && completedConversationId !== conversationId)
                onCurrentSessionConversationIdChange(completedConversationId)
              onConversationIdChange?.(completedConversationId)
              onConversationComplete?.(completedConversationId, workflowRunId)
            },
            onSendSettled: (hasError) => {
              setIsSendPending(false)
              if (hasError) notifySendInterrupted()
            },
          },
        })
        sendStarted = true
      } catch {
        return false
      } finally {
        if (!sendStarted) setIsSendPending(false)
      }
    },
    [
      agentId,
      agentSoulConfig,
      chatList,
      config,
      conversationId,
      draftType,
      handleSend,
      inputs,
      inputsForm,
      notifySendInterrupted,
      onConversationComplete,
      onConversationIdChange,
      onCurrentSessionConversationIdChange,
      onSaveDraftBeforeRun,
      queryClient,
      sendMessage,
      textGenerationModelList,
    ],
  )

  const doStopResponding = useCallback(() => {
    handleStop()
    notifySendInterrupted()
  }, [handleStop, notifySendInterrupted])

  const doRegenerate = useCallback(
    (chatItem: ChatItem, editedQuestion?: { message: string; files?: FileEntity[] }) => {
      const question = editedQuestion
        ? chatItem
        : chatList.find((item) => item.id === chatItem.parentMessageId)
      if (!question) return

      const parentAnswer = chatList.find((item) => item.id === question.parentMessageId)
      doSend(
        editedQuestion ? editedQuestion.message : question.content,
        editedQuestion ? editedQuestion.files : question.message_files,
        true,
        isValidGeneratedAnswer(parentAnswer) ? parentAnswer : null,
      )
    },
    [chatList, doSend],
  )
  const isEmptyChat = chatList.length === 0
  const sendButtonLoading = isEmptyChat && !!sendButtonLabel && (isSendPending || isResponding)
  useImperativeHandle(ref, () => ({ send: doSend, stop: doStopResponding }), [
    doSend,
    doStopResponding,
  ])
  useLayoutEffect(() => {
    onRuntimeStateChange({
      isEmptyChat,
      isResponding,
      isSendPending,
    })
  }, [isEmptyChat, isResponding, isSendPending, onRuntimeStateChange])

  return (
    <Chat
      answerActionPosition={answerActionPosition}
      config={config}
      speechToTextTarget={speechToTextTarget}
      onBeforeSpeechToText={onBeforeSpeechToText}
      chatList={chatList}
      isResponding={isResponding}
      sendButtonLabel={isEmptyChat ? sendButtonLabel : undefined}
      sendButtonLoading={sendButtonLoading}
      chatContainerClassName={cn('pt-6', isEmptyChat ? 'px-12 pt-2 !pb-[88px]' : 'px-3')}
      chatFooterClassName={isEmptyChat ? 'hidden' : 'px-3 pb-0 pt-10'}
      suggestedQuestions={suggestedQuestions}
      onSend={doSend}
      inputs={inputs}
      inputsForm={inputsForm}
      onRegenerate={doRegenerate}
      switchSibling={(siblingMessageId) => setTargetMessageId(siblingMessageId)}
      onStopResponding={doStopResponding}
      noChatInput
      showRegenerate
      questionIcon={<Avatar avatar={userProfile.avatar_url} name={userProfile.name} size="xl" />}
      onAnnotationEdited={handleAnnotationEdited}
      onAnnotationAdded={handleAnnotationAdded}
      onAnnotationRemoved={handleAnnotationRemoved}
      renderAgentContent={AgentRosterResponseContent}
      noSpacing
    />
  )
}
