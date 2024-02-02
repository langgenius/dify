'use client'

import { createContext, useContext } from 'use-context-selector'
import type {
  Callback,
  ChatConfig,
  ChatItem,
} from '../types'
import type {
  AppConversationData,
  AppData,
  ConversationItem,
} from '@/models/share'

export type ChatWithHistoryContextValue = {
  appData?: AppData
  appParams?: ChatConfig
  appChatListDataLoading?: boolean
  currentConversationId: string
  currentConversationItem?: ConversationItem
  appPrevChatList: ChatItem[]
  pinnedConversationList: AppConversationData['data']
  conversationList: AppConversationData['data']
  showConfigPanelBeforeChat: boolean
  newConversationInputs: Record<string, any>
  handleNewConversationInputsChange: (v: Record<string, any>) => void
  inputsForms: any[]
  handleNewConversation: () => void
  handleStartChat: () => void
  handleChangeConversation: (conversationId: string) => void
  handlePinConversation: (conversationId: string) => void
  handleUnpinConversation: (conversationId: string) => void
  handleDeleteConversation: (conversationId: string, callback: Callback) => void
  conversationRenaming: boolean
  handleRenameConversation: (conversationId: string, newName: string, callback: Callback) => void
  handleNewConversationCompleted: (newConversationId: string) => void
  chatShouldReloadKey: string
  isMobile: boolean
  isInstalledApp: boolean
  appId?: string
}

export const ChatWithHistoryContext = createContext<ChatWithHistoryContextValue>({
  currentConversationId: '',
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  showConfigPanelBeforeChat: false,
  newConversationInputs: {},
  handleNewConversationInputsChange: () => {},
  inputsForms: [],
  handleNewConversation: () => {},
  handleStartChat: () => {},
  handleChangeConversation: () => {},
  handlePinConversation: () => {},
  handleUnpinConversation: () => {},
  handleDeleteConversation: () => {},
  conversationRenaming: false,
  handleRenameConversation: () => {},
  handleNewConversationCompleted: () => {},
  chatShouldReloadKey: '',
  isMobile: false,
  isInstalledApp: false,
})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
