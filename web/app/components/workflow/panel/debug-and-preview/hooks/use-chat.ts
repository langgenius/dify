import type { ChatConfig } from './types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItemInTree, Inputs } from '@/app/components/base/chat/types'
import { setAutoFreeze } from 'immer'
import { useEffect, useRef } from 'react'
import { useStore } from '../../../store'
import { useChatFlowControl } from './use-chat-flow-control'
import { useChatList } from './use-chat-list'
import { useChatMessageSender } from './use-chat-message-sender'
import { useChatTreeOperations } from './use-chat-tree-operations'

export function useChat(
  config: ChatConfig | undefined,
  formSettings?: {
    inputs: Inputs
    inputsForm: InputForm[]
  },
  prevChatTree?: ChatItemInTree[],
  stopChat?: (taskId: string) => void,
) {
  const chatTree = useStore(s => s.chatTree)
  const conversationId = useStore(s => s.conversationId)
  const isResponding = useStore(s => s.isResponding)
  const suggestedQuestions = useStore(s => s.suggestedQuestions)
  const targetMessageId = useStore(s => s.targetMessageId)
  const updateChatTree = useStore(s => s.updateChatTree)
  const setTargetMessageId = useStore(s => s.setTargetMessageId)

  const initialChatTreeRef = useRef(prevChatTree)
  const suggestedQuestionsAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const initialChatTree = initialChatTreeRef.current
    if (!initialChatTree || initialChatTree.length === 0)
      return
    updateChatTree(currentChatTree => (currentChatTree.length === 0 ? initialChatTree : currentChatTree))
  }, [updateChatTree])

  useEffect(() => {
    setAutoFreeze(false)
    return () => {
      setAutoFreeze(true)
    }
  }, [])

  const { updateCurrentQAOnTree } = useChatTreeOperations(updateChatTree)

  const {
    hasStopResponded,
    taskIdRef,
    handleResponding,
    handleStop,
    handleRestart,
  } = useChatFlowControl({
    stopChat,
    suggestedQuestionsAbortControllerRef,
  })

  const {
    threadMessages,
    chatList,
  } = useChatList({
    chatTree,
    targetMessageId,
    config,
    formSettings,
  })

  const { handleSend } = useChatMessageSender({
    threadMessages,
    config,
    formSettings,
    hasStopResponded,
    taskIdRef,
    suggestedQuestionsAbortControllerRef,
    handleResponding,
    updateCurrentQAOnTree,
  })

  return {
    conversationId,
    chatList,
    setTargetMessageId,
    handleSend,
    handleStop,
    handleRestart,
    isResponding,
    suggestedQuestions,
  }
}
