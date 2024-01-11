'use client'

import { createContext, useContext } from 'use-context-selector'
import type { ChatConfig } from './types'
import { INITIAL_CONFIG } from './constants'

export type ChatContextValue = {
  config: ChatConfig
}

const ChatContext = createContext<ChatContextValue>({
  config: INITIAL_CONFIG,
})

type ChatContextProviderProps = {
  children: React.ReactNode
  config: ChatConfig
}

export const ChatContextProvider = ({
  children,
  config,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
