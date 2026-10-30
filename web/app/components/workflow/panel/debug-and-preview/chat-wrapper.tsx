import type { StartNodeType } from '../../nodes/start/types'
import type { ChatWrapperRefType } from './index'
import type { useTestConnections } from './use-test-connections'
import type { HumanInputFormSubmitData } from '@/app/components/base/chat/chat/answer/human-input-content/type'
import type { ChatItem, OnSend } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useEffect, useImperativeHandle, useMemo } from 'react'
import { useNodes } from 'reactflow'
import Chat from '@/app/components/base/chat/chat'
import { getLastAnswer, isValidGeneratedAnswer } from '@/app/components/base/chat/utils'
import { useFeatures } from '@/app/components/base/features/hooks'
import { workflowAppIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/console'
import { useStore, useWorkflowStore } from '../../store'
import { BlockEnum, WorkflowRunningStatus } from '../../types'
import ConversationVariableModal from './conversation-variable-modal'
import Empty from './empty'
import { useChat } from './hooks'
import { TestConnectionSetup } from './test-connections'
import UserInput from './user-input'

type ChatWrapperProps = {
  showConversationVariableModal: boolean
  onConversationModalHide: () => void
  showInputsFieldsPanel: boolean
  onHide: () => void
  connections: ReturnType<typeof useTestConnections>
  onChatStateChange?: (state: PreviewChatState) => void
}

export type PreviewChatState = { hasConversation: boolean; isResponding: boolean }

const ChatWrapper = ({
  ref,
  showConversationVariableModal,
  onConversationModalHide,
  showInputsFieldsPanel,
  onHide,
  connections: testConnections,
  onChatStateChange,
}: ChatWrapperProps & {
  ref: React.RefObject<ChatWrapperRefType | null>
}) => {
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find((node) => node.data.type === BlockEnum.Start)
  const startVariables = startNode?.data.variables
  const { appId } = useAtomValue(workflowAppIdentityAtom)
  const queryClient = useQueryClient()
  const { mutateAsync: stopChat } = useMutation(
    consoleQuery.apps.byAppId.chatMessages.byTaskId.stop.post.mutationOptions(),
  )
  const workflowStore = useWorkflowStore()
  const setMessageLogItem = useStore((state) => state.setMessageLogItem)
  const inputs = useStore((s) => s.inputs)
  const setInputs = useStore((s) => s.setInputs)
  const { beforeSend: checkTestConnections, cancelPendingCheck } = testConnections

  const initialInputs = useMemo(() => {
    const initInputs: Record<string, any> = {}
    if (startVariables) {
      startVariables.forEach((variable) => {
        if (variable.default !== undefined && variable.default !== null)
          initInputs[variable.variable] = variable.default
      })
    }
    return initInputs
  }, [startVariables])

  const features = useFeatures((s) => s.features)
  const config = useMemo(() => {
    return {
      opening_statement: features.opening?.enabled ? features.opening?.opening_statement || '' : '',
      suggested_questions: features.opening?.enabled
        ? features.opening?.suggested_questions || []
        : [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
    }
  }, [
    features.opening,
    features.suggested,
    features.text2speech,
    features.speech2text,
    features.citation,
    features.moderation,
    features.file,
  ])
  const setShowFeaturesPanel = useStore((s) => s.setShowFeaturesPanel)

  const handleGetSuggestedQuestions = useCallback(
    (messageId: string, onCancel: (cancel: () => void) => void) => {
      const options =
        consoleQuery.apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get.queryOptions({
          input: { params: { app_id: appId, message_id: messageId } },
          staleTime: 0,
          retry: false,
        })
      onCancel(() => {
        void queryClient.cancelQueries({ queryKey: options.queryKey, exact: true })
      })
      return queryClient.query(options)
    },
    [appId, queryClient],
  )

  const {
    conversationId,
    chatList,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleSend,
    handleRestart,
    handleSwitchSibling,
    handleSubmitHumanInputForm,
    getHumanInputNodeData,
  } = useChat(
    config,
    {
      inputs,
      inputsForm: (startVariables || []) as any,
    },
    [],
    (taskId) =>
      stopChat({
        params: { app_id: appId, task_id: taskId },
      }),
  )

  const hasConversation = isResponding || chatList.some((item) => !item.isOpeningStatement)
  const showConnectionSetup = !hasConversation && testConnections.nodes.length > 0
  useEffect(() => {
    onChatStateChange?.({ hasConversation, isResponding })
  }, [hasConversation, isResponding, onChatStateChange])

  const handleRestartChat = useCallback(() => {
    cancelPendingCheck()
    handleRestart()
    setMessageLogItem(undefined)
    setInputs(initialInputs)
  }, [handleRestart, setInputs, initialInputs, setMessageLogItem, cancelPendingCheck])

  const doSend: OnSend = useCallback(
    async (message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
      if (!(await checkTestConnections({ openOnFailure: hasConversation }))) return false
      handleSend(
        {
          query: message,
          files,
          inputs: workflowStore.getState().inputs,
          conversation_id: conversationId,
          parent_message_id:
            (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || undefined,
        },
        {
          onGetSuggestedQuestions: handleGetSuggestedQuestions,
        },
      )
    },
    [
      handleSend,
      workflowStore,
      conversationId,
      chatList,
      handleGetSuggestedQuestions,
      checkTestConnections,
      hasConversation,
    ],
  )

  const doRegenerate = useCallback(
    (chatItem: ChatItem, editedQuestion?: { message: string; files?: FileEntity[] }) => {
      const question = editedQuestion
        ? chatItem
        : chatList.find((item) => item.id === chatItem.parentMessageId)!
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

  const doSwitchSibling = useCallback(
    (siblingMessageId: string) => {
      handleSwitchSibling(siblingMessageId, {
        onGetSuggestedQuestions: handleGetSuggestedQuestions,
      })
    },
    [handleSwitchSibling, handleGetSuggestedQuestions],
  )

  const doHumanInputFormSubmit = useCallback(
    async (formToken: string, formData: HumanInputFormSubmitData) => {
      await handleSubmitHumanInputForm(formToken, formData)
    },
    [handleSubmitHumanInputForm],
  )

  const inputDisabled = useMemo(() => {
    const latestMessage = chatList[chatList.length - 1]
    return (
      latestMessage?.isAnswer &&
      latestMessage.workflowProcess?.status === WorkflowRunningStatus.Paused
    )
  }, [chatList])

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === EVENT_WORKFLOW_STOP) handleStop()
  })

  useImperativeHandle(ref, () => {
    return {
      handleRestart: handleRestartChat,
    }
  }, [handleRestartChat])

  useEffect(() => {
    if (Object.keys(initialInputs).length > 0) {
      setInputs({
        ...initialInputs,
        ...inputs,
      })
    }
  }, [initialInputs])

  useEffect(() => {
    if (isResponding) onHide()
  }, [isResponding, onHide])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Chat
          config={
            {
              ...config,
              supportCitationHitInfo: true,
            } as any
          }
          speechToTextTarget={{ type: 'consoleApp', appId }}
          chatList={showConnectionSetup ? [] : chatList}
          isResponding={isResponding}
          chatContainerClassName="px-3"
          chatContainerInnerClassName="pt-6 w-full max-w-full mx-auto"
          chatFooterClassName="px-4 rounded-bl-2xl"
          chatFooterInnerClassName="pb-0"
          showFileUpload
          showFeatureBar
          onFeatureBarClick={setShowFeaturesPanel}
          onSend={doSend}
          inputs={inputs}
          inputsForm={(startVariables || []) as any}
          onRegenerate={doRegenerate}
          onStopResponding={handleStop}
          onHumanInputFormSubmit={doHumanInputFormSubmit}
          getHumanInputNodeData={getHumanInputNodeData}
          chatNode={
            showConnectionSetup ? (
              <div className="flex min-h-full flex-col">
                {showInputsFieldsPanel && <UserInput />}
                <div className="flex flex-1 items-center justify-center p-4">
                  <TestConnectionSetup connections={testConnections} isResponding={isResponding} />
                </div>
              </div>
            ) : (
              <>
                {showInputsFieldsPanel && <UserInput />}
                {!chatList.length && <Empty />}
              </>
            )
          }
          noSpacing
          suggestedQuestions={suggestedQuestions}
          onOpenLog={setMessageLogItem}
          canOpenLog={(item) => !!item.workflow_run_id}
          chatAnswerContainerInner="pr-2!"
          switchSibling={doSwitchSibling}
          inputDisabled={inputDisabled || testConnections.checking}
          hideAvatar
        />
      </div>
      {showConversationVariableModal && (
        <ConversationVariableModal
          conversationID={conversationId}
          onHide={onConversationModalHide}
        />
      )}
    </div>
  )
}

ChatWrapper.displayName = 'ChatWrapper'

export default memo(ChatWrapper)
