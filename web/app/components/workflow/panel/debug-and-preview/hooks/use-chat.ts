import type { ChatConfig, SendCallback } from './types'
import type { InputForm } from '@/app/components/base/chat/chat/type'
import type { ChatItemInTree, Inputs } from '@/app/components/base/chat/types'
import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from 'reactflow'
import { CUSTOM_NODE } from '../../../constants'
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
  const store = useStoreApi()

  const initialChatTreeRef = useRef(prevChatTree)
  useEffect(() => {
    const initialChatTree = initialChatTreeRef.current
    if (!initialChatTree || initialChatTree.length === 0)
      return
    updateChatTree(currentChatTree => (currentChatTree.length === 0 ? initialChatTree : currentChatTree))
  }, [updateChatTree])

  const { updateCurrentQAOnTree } = useChatTreeOperations(updateChatTree)

  const {
    handleResponding,
    handleStop,
    handleRestart,
  } = useChatFlowControl({
    stopChat,
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

  const {
    handleSend,
    handleResume,
    handleSubmitHumanInputForm,
  } = useChatMessageSender({
    threadMessages,
    config,
    formSettings,
    handleResponding,
    updateCurrentQAOnTree,
  })

  const getHumanInputNodeData = useCallback((nodeID: string) => {
    const { getNodes } = store.getState()
    const nodes = getNodes().filter(node => node.type === CUSTOM_NODE)
    return nodes.find(node => node.id === nodeID)
  }, [store])

  const handleSwitchSibling = useCallback((
    siblingMessageId: string,
    callbacks: SendCallback,
  ) => {
    setTargetMessageId(siblingMessageId)

    const findMessageInTree = (nodes: ChatItemInTree[], targetId: string): ChatItemInTree | undefined => {
      for (const node of nodes) {
        if (node.id === targetId)
          return node
        if (node.children) {
          const found = findMessageInTree(node.children, targetId)
          if (found)
            return found
        }
      }
      return undefined
    }

    const targetMessage = findMessageInTree(chatTree, siblingMessageId)
    if (targetMessage?.workflow_run_id && targetMessage.humanInputFormDataList?.length) {
      handleResume(
        targetMessage.id,
        targetMessage.workflow_run_id,
        callbacks,
      )
    }
  }, [chatTree, handleResume, setTargetMessageId])

  return {
    conversationId,
    chatList,
    setTargetMessageId,
    handleSend,
    handleSwitchSibling,
    handleSubmitHumanInputForm,
    getHumanInputNodeData,
    handleStop,
    handleRestart,
    isResponding,
    suggestedQuestions,
  }
}
