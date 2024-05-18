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
import { useChat } from './hooks'
import type { ChatWrapperRefType } from './index'
import Chat from '@/app/components/base/chat/chat'
import type { OnSend } from '@/app/components/base/chat/types'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import {
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'

const ChatWrapper = forwardRef<ChatWrapperRefType>((_, ref) => {
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

  const doSend = useCallback<OnSend>((query, files) => {
    handleSend(
      {
        query,
        files,
        inputs: workflowStore.getState().inputs,
        conversation_id: conversationId,
      },
      {
        onGetSuggestedQuestions: (messageId, getAbortController) => fetchSuggestedQuestions(appDetail!.id, messageId, getAbortController),
      },
    )
  }, [conversationId, handleSend, workflowStore, appDetail])

  useImperativeHandle(ref, () => {
    return {
      handleRestart,
    }
  }, [handleRestart])

  return (
    <Chat
      config={{
        ...config,
        supportCitationHitInfo: true,
      } as any}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerClassName='px-4'
      chatContainerInnerClassName='pt-6'
      chatFooterClassName='px-4 rounded-bl-2xl'
      chatFooterInnerClassName='pb-4'
      onSend={doSend}
      onStopResponding={handleStop}
      chatNode={(
        <>
          <UserInput />
          {
            !chatList.length && (
              <Empty />
            )
          }
        </>
      )}
      suggestedQuestions={suggestedQuestions}
      showPromptLog
      chatAnswerContainerInner='!pr-2'
    />
  )
})

ChatWrapper.displayName = 'ChatWrapper'

export default memo(ChatWrapper)
