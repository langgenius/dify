'use client'

import { createContext, useContext } from 'use-context-selector'
import type { ChatConfig } from '../types'
import type {
  AppConversationData,
  AppData,
  AppMeta,
} from '@/models/share'

export type ChatWithHistoryContextValue = {
  appData?: AppData
  appMeta?: AppMeta
  appParams?: ChatConfig
  appConversationData?: AppConversationData
}

export const ChatWithHistoryContext = createContext<ChatWithHistoryContextValue>({})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
