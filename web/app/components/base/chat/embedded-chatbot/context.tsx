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
import { noop } from 'lodash-es'

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
  allowResetChat: boolean
  appId?: string
  handleFeedback: (messageId: string, feedback: Feedback) => void
  currentChatInstanceRef: RefObject<{ handleStop: () => void }>
  themeBuilder?: ThemeBuilder
  clearChatList?: boolean
  setClearChatList: (state: boolean) => void
  isResponding?: boolean
  setIsResponding: (state: boolean) => void,
  currentConversationInputs: Record<string, any> | null,
  setCurrentConversationInputs: (v: Record<string, any>) => void,
}

export const EmbeddedChatbotContext = createContext<EmbeddedChatbotContextValue>({
  currentConversationId: '',
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  handleNewConversationInputsChange: noop,
  inputsForms: [],
  handleNewConversation: noop,
  handleStartChat: noop,
  handleChangeConversation: noop,
  handleNewConversationCompleted: noop,
  chatShouldReloadKey: '',
  isMobile: false,
  isInstalledApp: false,
  allowResetChat: true,
  handleFeedback: noop,
  currentChatInstanceRef: { current: { handleStop: noop } },
  clearChatList: false,
  setClearChatList: noop,
  isResponding: false,
  setIsResponding: noop,
  currentConversationInputs: {},
  setCurrentConversationInputs: noop,
})
export const useEmbeddedChatbotContext = () => useContext(EmbeddedChatbotContext)
