'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  ChatConfig,
  ChatItem,
  OnSend,
} from '../types'
import type { Emoji } from '@/app/components/tools/types'

export type ChatContextValue = {
  config?: ChatConfig
  isResponsing?: boolean
  chatList: ChatItem[]
  showPromptLog?: boolean
  questionIcon?: ReactNode
  answerIcon?: ReactNode
  allToolIcons?: Record<string, string | Emoji>
  onSend?: OnSend
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
  isResponsing,
  chatList,
  showPromptLog,
  questionIcon,
  answerIcon,
  allToolIcons,
  onSend,
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
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
