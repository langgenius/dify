'use client'

import type { RefObject } from 'react'
import { createContext, useContext } from 'use-context-selector'
import type {
  ChatConfig,
  ChatItem,
  Feedback,
} from '../types'
import type { ThemeBuilder } from './theme/theme-context'
import type {
  AppConversationData,
  AppData,
  AppMeta,
  ConversationItem,
} from '@/models/share'

export type EmbeddedChatbotContextValue = {
  appInfoError?: any
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
  newConversationInputs: Record<string, any>
  newConversationInputsRef: RefObject<Record<string, any>>
  handleNewConversationInputsChange: (v: Record<string, any>) => void
  inputsForms: any[]
  handleNewConversation: () => void
  handleStartChat: (callback?: any) => void
  handleChangeConversation: (conversationId: string) => void
  handleNewConversationCompleted: (newConversationId: string) => void
  chatShouldReloadKey: string
  isMobile: boolean
  isInstalledApp: boolean
  appId?: string
  handleFeedback: (messageId: string, feedback: Feedback) => void
  currentChatInstanceRef: RefObject<{ handleStop: () => void }>
  themeBuilder?: ThemeBuilder
}

export const EmbeddedChatbotContext = createContext<EmbeddedChatbotContextValue>({
  currentConversationId: '',
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  handleNewConversationInputsChange: () => {},
  inputsForms: [],
  handleNewConversation: () => {},
  handleStartChat: () => {},
  handleChangeConversation: () => {},
  handleNewConversationCompleted: () => {},
  chatShouldReloadKey: '',
  isMobile: false,
  isInstalledApp: false,
  handleFeedback: () => {},
  currentChatInstanceRef: { current: { handleStop: () => {} } },
})
export const useEmbeddedChatbotContext = () => useContext(EmbeddedChatbotContext)
