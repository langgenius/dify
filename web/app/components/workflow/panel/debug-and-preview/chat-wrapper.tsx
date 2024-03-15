import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useWorkflowStore } from '../../store'
import UserInput from './user-input'
import { useChat } from './hooks'
import Chat from '@/app/components/base/chat/chat'
import type { OnSend } from '@/app/components/base/chat/types'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { fetchConvesationMessages } from '@/service/debug'
import { useStore as useAppStore } from '@/app/components/app/store'
import { stopWorkflowRun } from '@/service/workflow'

const ChatWrapper = () => {
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const features = featuresStore!.getState().features

  const config = useMemo(() => {
    return {
      opening_statement: features.opening.opening_statement,
      suggested_questions: features.opening.suggested_questions,
      suggested_questions_after_answer: features.suggested,
      text_to_speech: features.text2speech,
      speech_to_text: features.speech2text,
      retriever_resource: features.citation,
      sensitive_word_avoidance: features.moderation,
    }
  }, [features])

  const {
    conversationId,
    chatList,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleSend,
  } = useChat(config)

  const doSend = useCallback<OnSend>((query, files) => {
    const appId = useAppStore.getState().appDetail?.id

    if (appId) {
      handleSend(
        {
          query,
          files,
          inputs: workflowStore.getState().inputs,
          conversationId,
        },
        {
          onGetSuggestedQuestions: (conversationId, getAbortController) => fetchConvesationMessages(appId, conversationId, getAbortController),
        },
      )
    }
  }, [conversationId, handleSend, workflowStore])

  const doStop = useCallback(() => {
    const appId = useAppStore.getState().appDetail?.id
    const taskId = workflowStore.getState().taskId

    handleStop()
    stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
  }, [handleStop, workflowStore])

  return (
    <Chat
      config={config as any}
      chatList={chatList}
      isResponding={isResponding}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='pt-6'
      chatFooterClassName='px-4 rounded-bl-2xl'
      chatFooterInnerClassName='pb-4'
      onSend={doSend}
      onStopResponding={doStop}
      chatNode={<UserInput />}
      allToolIcons={{}}
      suggestedQuestions={suggestedQuestions}
    />
  )
}

export default memo(ChatWrapper)
