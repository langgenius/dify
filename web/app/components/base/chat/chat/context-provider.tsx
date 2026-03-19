'use client'

import type { ReactNode } from 'react'
import type { ChatContextValue } from './context'
import { useMemo } from 'react'
import { ChatContext } from './context'

type ChatContextProviderProps = {
  children: ReactNode
} & ChatContextValue

export const ChatContextProvider = ({
  children,
  readonly = false,
  config,
  isResponding,
  chatList,
  showPromptLog,
  questionIcon,
  answerIcon,
  onSend,
  onRegenerate,
  onAnnotationEdited,
  onAnnotationAdded,
  onAnnotationRemoved,
  disableFeedback,
  onFeedback,
  getHumanInputNodeData,
}: ChatContextProviderProps) => {
  const contextValue = useMemo(() => ({
    config,
    readonly,
    isResponding,
    chatList: chatList || [],
    showPromptLog,
    questionIcon,
    answerIcon,
    onSend,
    onRegenerate,
    onAnnotationEdited,
    onAnnotationAdded,
    onAnnotationRemoved,
    disableFeedback,
    onFeedback,
    getHumanInputNodeData,
  }), [
    config,
    readonly,
    isResponding,
    chatList,
    showPromptLog,
    questionIcon,
    answerIcon,
    onSend,
    onRegenerate,
    onAnnotationEdited,
    onAnnotationAdded,
    onAnnotationRemoved,
    disableFeedback,
    onFeedback,
    getHumanInputNodeData,
  ])

  return (
    <ChatContext.Provider value={contextValue}>
      {children}
    </ChatContext.Provider>
  )
}
