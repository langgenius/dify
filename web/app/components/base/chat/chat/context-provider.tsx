'use client'

import type { ReactNode } from 'react'
import type { ChatContextValue } from './context'
import { ChatContext } from './context'

type ChatContextProviderProps = {
  children: ReactNode
} & ChatContextValue

export const ChatContextProvider = ({
  children,
  readonly = false,
  config,
  isResponding,
  inputDisabled,
  chatList,
  onOpenLog,
  canOpenLog,
  questionIcon,
  answerIcon,
  onSend,
  onGenerativeUIStateChange,
  onRegenerate,
  showRegenerate,
  onAnnotationEdited,
  onAnnotationAdded,
  onAnnotationRemoved,
  disableFeedback,
  onFeedback,
  getHumanInputNodeData,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider
      value={{
        config,
        readonly,
        isResponding,
        inputDisabled,
        chatList: chatList || [],
        onOpenLog,
        canOpenLog,
        questionIcon,
        answerIcon,
        onSend,
        onGenerativeUIStateChange,
        onRegenerate,
        showRegenerate,
        onAnnotationEdited,
        onAnnotationAdded,
        onAnnotationRemoved,
        disableFeedback,
        onFeedback,
        getHumanInputNodeData,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}
