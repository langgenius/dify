'use client'
import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { FC } from 'react'
import type { ChatProps } from '../chat'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useState } from 'react'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { createTheme } from '../embedded-chatbot/theme/theme'
import ChatWrapper from './chat-wrapper'
import { ChatWithHistoryContext, useChatWithHistoryContext } from './context'
import Header from './header'
import HeaderInMobile from './header-in-mobile'
import { useChatWithHistory } from './hooks'
import Sidebar from './sidebar'

type ChatWithHistoryProps = {
  className?: string
}
const ChatWithHistory: FC<ChatWithHistoryProps> = ({ className }) => {
  const { appData, appChatListDataLoading, chatShouldReloadKey, isMobile, sidebarCollapseState } =
    useChatWithHistoryContext()
  const isSidebarCollapsed = sidebarCollapseState
  const site = appData?.site

  const [showSidePanel, setShowSidePanel] = useState(false)

  useEffect(() => {
    if (!isSidebarCollapsed) setShowSidePanel(false)
  }, [isSidebarCollapsed])

  useDocumentTitle(site?.title || 'Chat')

  return (
    <div
      className={cn('flex h-full bg-background-default-burn', isMobile && 'flex-col', className)}
    >
      {!isMobile && (
        <div
          className={cn(
            'flex w-59 flex-col p-1 pr-0 transition-all duration-200 ease-in-out',
            isSidebarCollapsed && 'w-0 overflow-hidden p-0!',
          )}
        >
          <Sidebar />
        </div>
      )}
      {isMobile && <HeaderInMobile />}
      <div className={cn('relative grow p-2', isMobile && 'h-[calc(100%-56px)] p-0')}>
        {isSidebarCollapsed && (
          <div
            className={cn(
              'absolute top-0 z-20 flex h-full w-[256px] flex-col p-2 transition-all duration-500 ease-in-out',
              showSidePanel ? 'left-0' : '-left-62',
            )}
            onMouseEnter={() => setShowSidePanel(true)}
            onMouseLeave={() => setShowSidePanel(false)}
          >
            <Sidebar isPanel panelVisible={showSidePanel} />
          </div>
        )}
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden border-[0,5px] border-components-panel-border-subtle bg-chatbot-bg',
            isMobile ? 'rounded-t-2xl' : 'rounded-2xl',
          )}
        >
          {!isMobile && <Header />}
          {appChatListDataLoading && <Loading type="app" />}
          {!appChatListDataLoading && <ChatWrapper key={chatShouldReloadKey} />}
        </div>
      </div>
    </div>
  )
}

type ChatWithHistoryWrapProps = {
  installedAppInfo?: InstalledAppResponse
  className?: string
  isNewAgent?: boolean
  renderAgentContent?: ChatProps['renderAgentContent']
}
const ChatWithHistoryWrap: FC<ChatWithHistoryWrapProps> = ({
  installedAppInfo,
  className,
  isNewAgent = false,
  renderAgentContent,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const {
    appData,
    appParams,
    appMeta,
    appChatListDataLoading,
    currentConversationId,
    currentConversationItem,
    appPrevChatTree,
    pinnedConversationList,
    conversationList,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationInputsChange,
    inputsForms,
    handleNewConversation,
    handleStartChat,
    handleChangeConversation,
    handlePinConversation,
    handleUnpinConversation,
    handleDeleteConversation,
    conversationRenaming,
    handleRenameConversation,
    handleNewConversationCompleted,
    chatShouldReloadKey,
    isInstalledApp,
    appId,
    handleFeedback,
    currentChatInstanceRef,
    sidebarCollapseState,
    handleSidebarCollapse,
    clearChatList,
    setClearChatList,
    isResponding,
    setIsResponding,
    currentConversationInputs,
    setCurrentConversationInputs,
    allInputsHidden,
    initUserVariables,
  } = useChatWithHistory(installedAppInfo)
  const theme = createTheme(
    appData?.site?.chat_color_theme ?? null,
    appData?.site?.chat_color_theme_inverted ?? false,
  )

  return (
    <ChatWithHistoryContext.Provider
      value={{
        appData,
        appParams,
        appMeta,
        appChatListDataLoading,
        currentConversationId,
        currentConversationItem,
        appPrevChatTree,
        pinnedConversationList,
        conversationList,
        newConversationInputs,
        newConversationInputsRef,
        handleNewConversationInputsChange,
        inputsForms,
        handleNewConversation,
        handleStartChat,
        handleChangeConversation,
        handlePinConversation,
        handleUnpinConversation,
        handleDeleteConversation,
        conversationRenaming,
        handleRenameConversation,
        handleNewConversationCompleted,
        chatShouldReloadKey,
        isMobile,
        isInstalledApp,
        appId,
        handleFeedback,
        currentChatInstanceRef,
        theme,
        sidebarCollapseState,
        handleSidebarCollapse,
        clearChatList,
        setClearChatList,
        isResponding,
        setIsResponding,
        currentConversationInputs,
        setCurrentConversationInputs,
        allInputsHidden,
        initUserVariables,
        isNewAgent,
        renderAgentContent,
      }}
    >
      <ChatWithHistory className={className} />
    </ChatWithHistoryContext.Provider>
  )
}

const ChatWithHistoryWrapWithCheckToken: FC<ChatWithHistoryWrapProps> = ({
  installedAppInfo,
  className,
  isNewAgent,
  renderAgentContent,
}) => {
  return (
    <ChatWithHistoryWrap
      installedAppInfo={installedAppInfo}
      className={className}
      isNewAgent={isNewAgent}
      renderAgentContent={renderAgentContent}
    />
  )
}

export default ChatWithHistoryWrapWithCheckToken
