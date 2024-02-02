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
  handleConversationIdInfoChange: (conversationId: string) => void
  appPrevChatList: ChatItem[]
  pinnedConversationList: AppConversationData['data']
  conversationList: AppConversationData['data']
  showConfigPanelBeforeChat: boolean
  setShowConfigPanelBeforeChat: (show: boolean) => void
  setShowNewConversationItemInList: (v: boolean) => void
  newConversationInputs: Record<string, any>
  handleNewConversationInputsChange: (v: Record<string, any>) => void
  inputsForms: any[]
  handleNewConversation: () => void
  handleStartChat: () => void
  handleChangeConversation: (conversationId: string) => void
  handlePinConversation: (conversationId: string) => void
  handleUnpinConversation: (conversationId: string) => void
  conversationDeleting: boolean
  handleDeleteConversation: (conversationId: string, callback: Callback) => void
  conversationRenaming: boolean
  handleRenameConversation: (conversationId: string, newName: string, callback: Callback) => void
  handleNewConversationCompleted: (newConversationId: string) => void
  newConversationId: string
  chatShouldReloadKey: string
}

export const ChatWithHistoryContext = createContext<ChatWithHistoryContextValue>({
  currentConversationId: '',
  handleConversationIdInfoChange: () => {},
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  showConfigPanelBeforeChat: false,
  setShowConfigPanelBeforeChat: () => {},
  setShowNewConversationItemInList: () => {},
  newConversationInputs: {},
  handleNewConversationInputsChange: () => {},
  inputsForms: [],
  handleNewConversation: () => {},
  handleStartChat: () => {},
  handleChangeConversation: () => {},
  handlePinConversation: () => {},
  handleUnpinConversation: () => {},
  conversationDeleting: false,
  handleDeleteConversation: () => {},
  conversationRenaming: false,
  handleRenameConversation: () => {},
  handleNewConversationCompleted: () => {},
  newConversationId: '',
  chatShouldReloadKey: '',
})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
