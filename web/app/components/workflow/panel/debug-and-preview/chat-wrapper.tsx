import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import { BlockEnum } from '../../types'
import {
  useStore,
  useWorkflowStore,
} from '../../store'
import type { StartNodeType } from '../../nodes/start/types'
import Empty from './empty'
import UserInput from './user-input'
import ConversationVariableModal from './conversation-variable-modal'
import { useChat } from './hooks'
import type { ChatWrapperRefType } from './index'
import Chat from '@/app/components/base/chat/chat'
import type { ChatItem, OnSend } from '@/app/components/base/chat/types'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import {
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'

type ChatWrapperProps = {
  showConversationVariableModal: boolean
  onConversationModalHide: () => void
  showInputsFieldsPanel: boolean
}

const ChatWrapper = forwardRef<ChatWrapperRefType, ChatWrapperProps>(({ showConversationVariableModal, onConversationModalHide, showInputsFieldsPanel }, ref) => {
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const startVariables = startNode?.data.variables
  const appDetail = useAppStore(s => s.appDetail)
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const inputs = useStore(s => s.inputs)
  const features = featuresStore!.getState().features

  const config = useMemo(() => {
    return {
      opening_statement: features.opening?.opening_statement || '',
      suggested_questions: features.opening?.suggested_questions || [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
    }
  }, [features])

  const {
    conversationId,
    chatList,
    chatListRef,
    handleUpdateChatList,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleSend,
    handleRestart,
  } = useChat(
    config,
    {
      inputs,
      promptVariables: (startVariables as any) || [],
    },
    [],
    taskId => stopChatMessageResponding(appDetail!.id, taskId),
  )

  const doSend = useCallback<OnSend>((query, files, last_answer) => {
    const lastAnswer = chatListRef.current.at(-1)

    handleSend(
      {
        query,
        files,
        inputs: workflowStore.getState().inputs,
        conversation_id: conversationId,
        parent_message_id: last_answer?.id || (lastAnswer
          ? lastAnswer.isOpeningStatement
            ? null
            : lastAnswer.id
          : null),
      },
      {
        onGetSuggestedQuestions: (messageId, getAbortController) => fetchSuggestedQuestions(appDetail!.id, messageId, getAbortController),
      },
    )
  }, [chatListRef, conversationId, handleSend, workflowStore, appDetail])

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

  useImperativeHandle(ref, () => {
    return {
      handleRestart,
    }
  }, [handleRestart])

  return (
    <>
      <Chat
        config={{
          ...config,
          supportCitationHitInfo: true,
        } as any}
        chatList={chatList}
        isResponding={isResponding}
        chatContainerClassName='px-3'
        chatContainerInnerClassName='pt-6 w-full max-w-full mx-auto'
        chatFooterClassName='px-4 rounded-bl-2xl'
        chatFooterInnerClassName='pb-4 w-full max-w-full mx-auto'
        onSend={doSend}
        onRegenerate={doRegenerate}
        onStopResponding={handleStop}
        chatNode={(
          <>
            {showInputsFieldsPanel && <UserInput />}
            {
              !chatList.length && (
                <Empty />
              )
            }
          </>
        )}
        noSpacing
        suggestedQuestions={suggestedQuestions}
        showPromptLog
        chatAnswerContainerInner='!pr-2'
      />
      {showConversationVariableModal && (
        <ConversationVariableModal
          conversationID={conversationId}
          onHide={onConversationModalHide}
        />
      )}
    </>
  )
})

ChatWrapper.displayName = 'ChatWrapper'

export default memo(ChatWrapper)
