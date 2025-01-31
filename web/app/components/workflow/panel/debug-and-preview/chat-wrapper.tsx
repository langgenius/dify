import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
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
import type { ChatItem, ChatItemInTree, OnSend } from '@/app/components/base/chat/types'
import { useFeatures } from '@/app/components/base/features/hooks'
import {
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import { getLastAnswer, isValidGeneratedAnswer } from '@/app/components/base/chat/utils'

type ChatWrapperProps = {
  showConversationVariableModal: boolean
  onConversationModalHide: () => void
  showInputsFieldsPanel: boolean
  onHide: () => void
}

const ChatWrapper = forwardRef<ChatWrapperRefType, ChatWrapperProps>(({
  showConversationVariableModal,
  onConversationModalHide,
  showInputsFieldsPanel,
  onHide,
}, ref) => {
  const nodes = useNodes<StartNodeType>()
  const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
  const startVariables = startNode?.data.variables
  const appDetail = useAppStore(s => s.appDetail)
  const workflowStore = useWorkflowStore()
  const inputs = useStore(s => s.inputs)
  const features = useFeatures(s => s.features)
  const config = useMemo(() => {
    return {
      opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
      suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
      file_upload: features.file,
    }
  }, [features.opening, features.suggested, features.text2speech, features.speech2text, features.citation, features.moderation, features.file])
  const setShowFeaturesPanel = useStore(s => s.setShowFeaturesPanel)

  const {
    conversationId,
    chatList,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleSend,
    handleRestart,
    setTargetMessageId,
  } = useChat(
    config,
    {
      inputs,
      inputsForm: (startVariables || []) as any,
    },
    [],
    taskId => stopChatMessageResponding(appDetail!.id, taskId),
  )

  const doSend: OnSend = useCallback((message, files, isRegenerate = false, parentAnswer: ChatItem | null = null) => {
    handleSend(
      {
        query: message,
        files,
        inputs: workflowStore.getState().inputs,
        conversation_id: conversationId,
        parent_message_id: (isRegenerate ? parentAnswer?.id : getLastAnswer(chatList)?.id) || undefined,
      },
      {
        onGetSuggestedQuestions: (messageId, getAbortController) => fetchSuggestedQuestions(appDetail!.id, messageId, getAbortController),
      },
    )
  }, [handleSend, workflowStore, conversationId, chatList, appDetail])

  const doRegenerate = useCallback((chatItem: ChatItemInTree) => {
    const question = chatList.find(item => item.id === chatItem.parentMessageId)!
    const parentAnswer = chatList.find(item => item.id === question.parentMessageId)
    doSend(question.content, question.message_files, true, isValidGeneratedAnswer(parentAnswer) ? parentAnswer : null)
  }, [chatList, doSend])

  useImperativeHandle(ref, () => {
    return {
      handleRestart,
    }
  }, [handleRestart])

  useEffect(() => {
    if (isResponding)
      onHide()
  }, [isResponding, onHide])

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
        chatFooterInnerClassName='pb-0'
        showFileUpload
        showFeatureBar
        onFeatureBarClick={setShowFeaturesPanel}
        onSend={doSend}
        inputs={inputs}
        inputsForm={(startVariables || []) as any}
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
        switchSibling={setTargetMessageId}
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
