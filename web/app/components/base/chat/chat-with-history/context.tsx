'use client'

import type { RefObject } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  Callback,
  ChatConfig,
  ChatItem,
  Feedback,
} from '../types'
import type {
  AppConversationData,
  AppData,
  AppMeta,
  ConversationItem,
} from '@/models/share'

export type ChatWithHistoryContextValue = {
  appInfoLoading?: boolean
  appMeta?: AppMeta
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
  handleFeedback: (messageId: string, feedback: Feedback) => void
  currentChatInstanceRef: RefObject<{ handleStop: () => void }>
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
  handleFeedback: () => {},
  currentChatInstanceRef: { current: { handleStop: () => {} } },
})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
