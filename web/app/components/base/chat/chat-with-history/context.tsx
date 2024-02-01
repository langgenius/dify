'use client'

import { createContext, useContext } from 'use-context-selector'
import type {
  ChatConfig,
  ChatItem,
} from '../types'
import type {
  AppConversationData,
  AppData,
  AppMeta,
  ConversationItem,
} from '@/models/share'
import type { InstalledApp } from '@/models/explore'

export type ChatWithHistoryContextValue = {
  installedAppInfo?: InstalledApp
  appData?: AppData
  appMeta?: AppMeta
  appParams?: ChatConfig
  appPinnedConversationData?: AppConversationData
  appConversationData?: AppConversationData
  appChatListData?: any
  appChatListDataLoading?: boolean
  currentConversationId: string
  currentConversationItem?: ConversationItem
  handleCurrentConversationIdChange: (conversationId: string) => void
  appPrevChatList: ChatItem[]
  pinnedConversationList: AppConversationData['data']
  conversationList: AppConversationData['data']
  showConfigPanel: boolean
  setShowConfigPanel: (show: boolean) => void
  setShowNewConversationItemInList: (v: boolean) => void
  newConversationInputs: Record<string, any>
  setNewConversationInputs: (v: Record<string, any>) => void
  inputsForms: any[]
  handleNewConversation: () => void
  handleStartChat: () => void
}

export const ChatWithHistoryContext = createContext<ChatWithHistoryContextValue>({
  currentConversationId: '',
  handleCurrentConversationIdChange: () => {},
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  showConfigPanel: false,
  setShowConfigPanel: () => {},
  setShowNewConversationItemInList: () => {},
  newConversationInputs: {},
  setNewConversationInputs: () => {},
  inputsForms: [],
  handleNewConversation: () => {},
  handleStartChat: () => {},
})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
