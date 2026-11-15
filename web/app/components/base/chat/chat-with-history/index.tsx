'use client'
import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { FC } from 'react'
import type { ChatProps } from '../chat'
import { cn } from '@langgenius/dify-ui/cn'
import { useMediaQuery } from '@langgenius/dify-ui/use-media-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
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
  const { appData, appChatListDataLoading, chatShouldReloadKey, isBelowSm, sidebarCollapseState } =
    useChatWithHistoryContext()
  const isSidebarCollapsed = sidebarCollapseState
  const site = appData?.site

  const [showSidePanel, setShowSidePanel] = useState(false)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const sidePanelHasFocusRef = useRef(false)
  const sidePanelHoveredRef = useRef(false)
  const sidePanelBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const previousSidebarCollapsedRef = useRef(isSidebarCollapsed)

  useLayoutEffect(() => {
    if (previousSidebarCollapsedRef.current !== isSidebarCollapsed) {
      sidebarToggleRef.current?.focus()
      previousSidebarCollapsedRef.current = isSidebarCollapsed
    }
  }, [isSidebarCollapsed])

  useEffect(() => {
    if (!isSidebarCollapsed || isBelowSm) {
      setShowSidePanel(false)
      sidePanelHasFocusRef.current = false
      sidePanelHoveredRef.current = false
    }
    return () => clearTimeout(sidePanelBlurTimeoutRef.current)
  }, [isSidebarCollapsed, isBelowSm])

  useDocumentTitle(site?.title || 'Chat')

  return (
    <div
      className={cn('flex h-full bg-background-default-burn', isBelowSm && 'flex-col', className)}
    >
      {!isBelowSm && (
        <div
          inert={isSidebarCollapsed}
          className={cn(
            'flex w-59 flex-col p-1 pe-0 transition-all duration-200 ease-in-out',
            isSidebarCollapsed && 'w-0 overflow-hidden p-0!',
          )}
        >
          <Sidebar toggleButtonRef={!isSidebarCollapsed ? sidebarToggleRef : undefined} />
        </div>
      )}
      {isBelowSm && <HeaderInMobile />}
      <div className={cn('relative grow p-2', isBelowSm && 'h-[calc(100%-56px)] p-0')}>
        {!isBelowSm && isSidebarCollapsed && (
          <div
            className={cn(
              'absolute top-0 z-20 flex h-full w-[256px] flex-col p-2 transition-all duration-500 ease-in-out',
              showSidePanel ? 'inset-s-0' : '-inset-s-62',
            )}
            onMouseEnter={() => {
              sidePanelHoveredRef.current = true
              setShowSidePanel(true)
            }}
            onFocusCapture={() => {
              // React focus events include the sidebar's portalled menus and dialogs.
              clearTimeout(sidePanelBlurTimeoutRef.current)
              sidePanelHasFocusRef.current = true
            }}
            onBlurCapture={() => {
              sidePanelHasFocusRef.current = false
              // Native Tab can flush microtasks between blur and focus. Wait until
              // the focus transition finishes, including moves through portals.
              clearTimeout(sidePanelBlurTimeoutRef.current)
              sidePanelBlurTimeoutRef.current = setTimeout(() => {
                if (!sidePanelHasFocusRef.current && !sidePanelHoveredRef.current)
                  setShowSidePanel(false)
              }, 0)
            }}
            onMouseLeave={() => {
              sidePanelHoveredRef.current = false
              if (!sidePanelHasFocusRef.current) setShowSidePanel(false)
            }}
          >
            <div inert={!showSidePanel} className="flex min-h-0 grow">
              <Sidebar isPanel panelVisible={showSidePanel} />
            </div>
          </div>
        )}
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden border-[0,5px] border-components-panel-border-subtle bg-chatbot-bg',
            isBelowSm ? 'rounded-t-2xl' : 'rounded-2xl',
          )}
        >
          {!isBelowSm && (
            <Header toggleButtonRef={isSidebarCollapsed ? sidebarToggleRef : undefined} />
          )}
          {appChatListDataLoading && <LoadingPlaceholder className="h-full" />}
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
  const isBelowSm = useMediaQuery('(width < 40rem)', {})

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
        isBelowSm,
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
