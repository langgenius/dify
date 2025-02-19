'use client'

import type { RefObject } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  Callback,
  ChatConfig,
  ChatItemInTree,
  Feedback,
} from '../types'
import type { ThemeBuilder } from '../embedded-chatbot/theme/theme-context'
import type {
  AppConversationData,
  AppData,
  AppMeta,
  ConversationItem,
} from '@/models/share'

export type ChatWithHistoryContextValue = {
  appInfoError?: any
  appInfoLoading?: boolean
  appMeta?: AppMeta
  appData?: AppData
  appParams?: ChatConfig
  appChatListDataLoading?: boolean
  currentConversationId: string
  currentConversationItem?: ConversationItem
  appPrevChatTree: ChatItemInTree[]
  pinnedConversationList: AppConversationData['data']
  conversationList: AppConversationData['data']
  newConversationInputs: Record<string, any>
  newConversationInputsRef: RefObject<Record<string, any>>
  handleNewConversationInputsChange: (v: Record<string, any>) => void
  inputsForms: any[]
  handleNewConversation: () => void
  handleStartChat: (callback?: any) => void
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
  themeBuilder?: ThemeBuilder
  sidebarCollapseState?: boolean
  handleSidebarCollapse: (state: boolean) => void
}

export const ChatWithHistoryContext = createContext<ChatWithHistoryContextValue>({
  currentConversationId: '',
  appPrevChatTree: [],
  pinnedConversationList: [],
  conversationList: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
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
  sidebarCollapseState: false,
  handleSidebarCollapse: () => {},
})
export const useChatWithHistoryContext = () => useContext(ChatWithHistoryContext)
