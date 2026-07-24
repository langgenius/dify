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
  return (
    <ChatContext.Provider value={{
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
    }}
    >
      {children}
    </ChatContext.Provider>
  )
}
