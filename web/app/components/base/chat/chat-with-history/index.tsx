import type { FC } from 'react'
import {
  useEffect,
  useState,
} from 'react'
import { useAsyncEffect } from 'ahooks'
import { useThemeContext } from '../embedded-chatbot/theme/theme-context'
import {
  ChatWithHistoryContext,
  useChatWithHistoryContext,
} from './context'
import { useChatWithHistory } from './hooks'
import Sidebar from './sidebar'
import Header from './header'
import HeaderInMobile from './header-in-mobile'
import ChatWrapper from './chat-wrapper'
import type { InstalledApp } from '@/models/explore'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { checkOrSetAccessToken } from '@/app/components/share/utils'
import AppUnavailable from '@/app/components/base/app-unavailable'
import cn from '@/utils/classnames'

type ChatWithHistoryProps = {
  className?: string
}
const ChatWithHistory: FC<ChatWithHistoryProps> = ({
  className,
}) => {
  const {
    appInfoError,
    appData,
    appInfoLoading,
    appChatListDataLoading,
    chatShouldReloadKey,
    isMobile,
    themeBuilder,
    sidebarCollapseState,
  } = useChatWithHistoryContext()
  const isSidebarCollapsed = sidebarCollapseState
  const customConfig = appData?.custom_config
  const site = appData?.site

  const [showSidePanel, setShowSidePanel] = useState(false)

  useEffect(() => {
    themeBuilder?.buildTheme(site?.chat_color_theme, site?.chat_color_theme_inverted)
    if (site) {
      if (customConfig)
        document.title = `${site.title}`
      else
        document.title = `${site.title} - Powered by Dify`
    }
  }, [site, customConfig, themeBuilder])

  if (appInfoLoading) {
    return (
      <Loading type='app' />
    )
  }

  if (appInfoError) {
    return (
      <AppUnavailable />
    )
  }

  return (
    <div className={cn(
      'h-full flex bg-background-default-burn',
      isMobile && 'flex-col',
      className,
    )}>
      {!isMobile && (
        <div className={cn(
          'flex flex-col w-[236px] p-1 pr-0 transition-all duration-200 ease-in-out',
          isSidebarCollapsed && 'w-0 !p-0 overflow-hidden',
        )}>
          <Sidebar />
        </div>
      )}
      {isMobile && (
        <HeaderInMobile />
      )}
      <div className={cn('relative grow p-2')}>
        {isSidebarCollapsed && (
          <div
            className={cn(
              'z-20 absolute top-0 w-[256px] h-full flex flex-col p-2 transition-all duration-500 ease-in-out',
              showSidePanel ? 'left-0' : 'left-[-248px]',
            )}
            onMouseEnter={() => setShowSidePanel(true)}
            onMouseLeave={() => setShowSidePanel(false)}
          >
            <Sidebar isPanel />
          </div>
        )}
        <div className='h-full flex flex-col bg-chatbot-bg rounded-2xl border-[0,5px] border-components-panel-border-subtle overflow-hidden'>
          {!isMobile && <Header />}
          {appChatListDataLoading && (
            <Loading type='app' />
          )}
          {!appChatListDataLoading && (
            <ChatWrapper key={chatShouldReloadKey} />
          )}
        </div>
      </div>
    </div>
  )
}

export type ChatWithHistoryWrapProps = {
  installedAppInfo?: InstalledApp
  className?: string
}
const ChatWithHistoryWrap: FC<ChatWithHistoryWrapProps> = ({
  installedAppInfo,
  className,
}) => {
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const themeBuilder = useThemeContext()

  const {
    appInfoError,
    appInfoLoading,
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
  } = useChatWithHistory(installedAppInfo)

  return (
    <ChatWithHistoryContext.Provider value={{
      appInfoError,
      appInfoLoading,
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
      themeBuilder,
      sidebarCollapseState,
      handleSidebarCollapse,
    }}>
      <ChatWithHistory className={className} />
    </ChatWithHistoryContext.Provider>
  )
}

const ChatWithHistoryWrapWithCheckToken: FC<ChatWithHistoryWrapProps> = ({
  installedAppInfo,
  className,
}) => {
  const [initialized, setInitialized] = useState(false)
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknownReason, setIsUnknownReason] = useState<boolean>(false)

  useAsyncEffect(async () => {
    if (!initialized) {
      if (!installedAppInfo) {
        try {
          await checkOrSetAccessToken()
        }
        catch (e: any) {
          if (e.status === 404) {
            setAppUnavailable(true)
          }
          else {
            setIsUnknownReason(true)
            setAppUnavailable(true)
          }
        }
      }
      setInitialized(true)
    }
  }, [])

  if (!initialized)
    return null

  if (appUnavailable)
    return <AppUnavailable isUnknownReason={isUnknownReason} />

  return (
    <ChatWithHistoryWrap
      installedAppInfo={installedAppInfo}
      className={className}
    />
  )
}

export default ChatWithHistoryWrapWithCheckToken
