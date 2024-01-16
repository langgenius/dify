'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type { ChatConfig } from './types'
import { INITIAL_CONFIG } from './constants'

export type ChatContextValue = {
  config: ChatConfig
  isResponsing: boolean
  showPromptLog?: boolean
  questionIcon?: ReactNode
}

const ChatContext = createContext<ChatContextValue>({
  config: INITIAL_CONFIG,
  isResponsing: false,
  showPromptLog: false,
})

type ChatContextProviderProps = {
  children: ReactNode
} & ChatContextValue

export const ChatContextProvider = ({
  children,
  config,
  isResponsing,
  showPromptLog,
  questionIcon,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
      isResponsing,
      showPromptLog,
      questionIcon,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
