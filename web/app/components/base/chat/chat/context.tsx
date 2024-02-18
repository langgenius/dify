'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type { ChatProps } from './index'

export type ChatContextValue = Pick<ChatProps, 'config'
  | 'isResponsing'
  | 'chatList'
  | 'showPromptLog'
  | 'questionIcon'
  | 'answerIcon'
  | 'allToolIcons'
  | 'onSend'
  | 'onAnnotationEdited'
  | 'onAnnotationAdded'
  | 'onAnnotationRemoved'
  | 'onFeedback'
>

const ChatContext = createContext<ChatContextValue>({
  chatList: [],
})

type ChatContextProviderProps = {
  children: ReactNode
} & ChatContextValue

export const ChatContextProvider = ({
  children,
  config,
  isResponsing,
  chatList,
  showPromptLog,
  questionIcon,
  answerIcon,
  allToolIcons,
  onSend,
  onAnnotationEdited,
  onAnnotationAdded,
  onAnnotationRemoved,
  onFeedback,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
      isResponsing,
      chatList: chatList || [],
      showPromptLog,
      questionIcon,
      answerIcon,
      allToolIcons,
      onSend,
      onAnnotationEdited,
      onAnnotationAdded,
      onAnnotationRemoved,
      onFeedback,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
