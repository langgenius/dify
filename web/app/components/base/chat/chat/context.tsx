'use client'

import type { ReactNode } from 'react'
import type { ChatProps } from './index'
import { createContext, useContext } from 'use-context-selector'

export type ChatContextValue = Pick<ChatProps, 'config'
  | 'isResponding'
  | 'chatList'
  | 'showPromptLog'
  | 'questionIcon'
  | 'answerIcon'
  | 'onSend'
  | 'onRegenerate'
  | 'onAnnotationEdited'
  | 'onAnnotationAdded'
  | 'onAnnotationRemoved'
  | 'disableFeedback'
  | 'onFeedback'> & {
    readonly?: boolean
  }

const ChatContext = createContext<ChatContextValue>({
  chatList: [],
  readonly: false,
})

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
    }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
