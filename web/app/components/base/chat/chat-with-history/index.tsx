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
import HeaderInMobile from './header-in-mobile'
import ConfigPanel from './config-panel'
import ChatWrapper from './chat-wrapper'
import type { InstalledApp } from '@/models/explore'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { checkOrSetAccessToken } from '@/app/components/share/utils'
import AppUnavailable from '@/app/components/base/app-unavailable'

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
    appPrevChatList,
    showConfigPanelBeforeChat,
    appChatListDataLoading,
    chatShouldReloadKey,
    isMobile,
    themeBuilder,
  } = useChatWithHistoryContext()

  const chatReady = (!showConfigPanelBeforeChat || !!appPrevChatList.length)
  const customConfig = appData?.custom_config
  const site = appData?.site

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
    <div className={`h-full flex bg-white ${className} ${isMobile && 'flex-col'}`}>
      {
        !isMobile && (
          <Sidebar />
        )
      }
      {
        isMobile && (
          <HeaderInMobile />
        )
      }
      <div className={`grow overflow-hidden ${showConfigPanelBeforeChat && !appPrevChatList.length && 'flex items-center justify-center'}`}>
        {
          showConfigPanelBeforeChat && !appChatListDataLoading && !appPrevChatList.length && (
            <div className={`flex w-full items-center justify-center h-full ${isMobile && 'px-4'}`}>
              <ConfigPanel />
            </div>
          )
        }
        {
          appChatListDataLoading && chatReady && (
            <Loading type='app' />
          )
        }
        {
          chatReady && !appChatListDataLoading && (
            <ChatWrapper key={chatShouldReloadKey} />
          )
        }
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
    appPrevChatList,
    pinnedConversationList,
    conversationList,
    showConfigPanelBeforeChat,
    newConversationInputs,
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
      appPrevChatList,
      pinnedConversationList,
      conversationList,
      showConfigPanelBeforeChat,
      newConversationInputs,
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
