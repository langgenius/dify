'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  ChatConfig,
  OnSend,
} from './types'
import { INITIAL_CONFIG } from './constants'
import type { Emoji } from '@/app/components/tools/types'

export type ChatContextValue = {
  config: ChatConfig
  isResponsing: boolean
  showPromptLog?: boolean
  questionIcon?: ReactNode
  allToolIcons?: Record<string, string | Emoji>
  onSend?: OnSend
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
  allToolIcons,
  onSend,
}: ChatContextProviderProps) => {
  return (
    <ChatContext.Provider value={{
      config,
      isResponsing,
      showPromptLog,
      questionIcon,
      allToolIcons,
      onSend,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export const useChatContext = () => useContext(ChatContext)

export default ChatContext
