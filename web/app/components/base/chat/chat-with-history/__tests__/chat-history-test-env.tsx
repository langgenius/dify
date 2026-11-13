import type { ReactElement, ReactNode } from 'react'
import type { ChatConfig } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { AppData, ConversationItem } from '@/models/share'
import { useWebAppStore } from '@/context/web-app-context'
import { AppSourceType } from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import { ChatWithHistoryContext } from '../context'
import { useChatWithHistory } from '../hooks'

export const conversation: ConversationItem = {
  id: 'conversation-1',
  name: 'My Chat',
  inputs: {},
  introduction: '',
}

export function createChatHistoryTestEnvironment({
  currentConversationId = conversation.id,
  conversations = [conversation],
  pinnedConversations = [],
  appInfo = {
    app_id: 'app-1',
    end_user_id: 'user-1',
    site: { title: 'Test Chat' },
    custom_config: null,
  },
  appParams = createChatConfigFixture(),
  sidebarCollapsed = true,
  ownerProps = {},
}: {
  currentConversationId?: string
  conversations?: ConversationItem[]
  pinnedConversations?: ConversationItem[]
  appInfo?: AppData
  appParams?: ChatConfig
  sidebarCollapsed?: boolean
  // These are caller-owned display inputs; all conversation commands come from the real owner.
  ownerProps?: Pick<Partial<ChatWithHistoryContextValue>, 'isBelowSm' | 'isResponding'>
} = {}) {
  window.history.replaceState({}, '', '/')
  const selection = JSON.stringify({
    [appInfo.app_id]: { [appInfo.end_user_id || 'DEFAULT']: currentConversationId },
  })
  localStorage.setItem(CONVERSATION_ID_INFO, selection)
  sessionStorage.setItem(TAB_CONVERSATION_ID_INFO, selection)
  localStorage.setItem('webappSidebarCollapse', sidebarCollapsed ? 'collapsed' : 'expanded')
  useWebAppStore.setState({ appInfo, appParams, appMeta: { tool_icons: {} } })
  const queryClient = createConsoleQueryClient()
  const listKey = (pinned: boolean) =>
    shareQueryKeys.conversationList(null, {
      appSourceType: AppSourceType.webApp,
      appId: appInfo.app_id,
      pinned,
      limit: 100,
    })
  queryClient.setQueryData(listKey(false), { data: conversations, has_more: false, limit: 100 })
  queryClient.setQueryData(listKey(true), {
    data: pinnedConversations,
    has_more: false,
    limit: 100,
  })
  function Owner({
    children,
    displayProps = ownerProps,
  }: {
    children: ReactNode
    displayProps?: typeof ownerProps
  }) {
    const value = useChatWithHistory()
    return (
      <ChatWithHistoryContext.Provider value={{ ...value, isBelowSm: false, ...displayProps }}>
        {children}
      </ChatWithHistoryContext.Provider>
    )
  }
  return {
    Owner,
    queryClient,
    webAppStore: useWebAppStore,
    listKey,
  }
}

export function renderChatHistory(
  ui: ReactElement,
  options: Parameters<typeof createChatHistoryTestEnvironment>[0] = {},
) {
  const { Owner, queryClient, ...environment } = createChatHistoryTestEnvironment(options)
  return {
    ...renderWithConsoleQuery(<Owner>{ui}</Owner>, { queryClient }),
    ...environment,
  }
}
