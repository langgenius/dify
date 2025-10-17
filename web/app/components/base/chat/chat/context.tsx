'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type { ChatProps } from './index'

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
  | 'onFeedback'
> & {
  showReasoning?: boolean
}

const ChatContext = createContext<ChatContextValue>({
  chatList: [],
})

type ChatContextProviderProps = {
  children: ReactNode
} & ChatContextValue

export const ChatContextProvider = ({
  children,
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
  onFeedback,
  showReasoning,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
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
      onFeedback,
      showReasoning,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
