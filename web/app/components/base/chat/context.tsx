'use client'

import { createContext, useContext } from 'use-context-selector'
import type { ChatConfig } from './types'
import { INITIAL_CONFIG } from './constants'

export type ChatContextValue = {
  config: ChatConfig
  isResponsing: boolean
}

const ChatContext = createContext<ChatContextValue>({
  config: INITIAL_CONFIG,
  isResponsing: false,
})

type ChatContextProviderProps = {
  children: React.ReactNode
  config: ChatConfig
  isResponsing: boolean
}

export const ChatContextProvider = ({
  children,
  config,
  isResponsing,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
      isResponsing,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
