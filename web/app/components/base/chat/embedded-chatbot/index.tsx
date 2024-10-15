import {
  useEffect,
  useState,
} from 'react'
import { useAsyncEffect } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { RiLoopLeftLine } from '@remixicon/react'
import {
  EmbeddedChatbotContext,
  useEmbeddedChatbotContext,
} from './context'
import { useEmbeddedChatbot } from './hooks'
import { isDify } from './utils'
import { useThemeContext } from './theme/theme-context'
import cn from '@/utils/classnames'
import { checkOrSetAccessToken } from '@/app/components/share/utils'
import AppUnavailable from '@/app/components/base/app-unavailable'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import LogoHeader from '@/app/components/base/logo/logo-embedded-chat-header'
import Header from '@/app/components/base/chat/embedded-chatbot/header'
import ConfigPanel from '@/app/components/base/chat/embedded-chatbot/config-panel'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import Tooltip from '@/app/components/base/tooltip'

const Chatbot = () => {
  const { t } = useTranslation()
  const {
    isMobile,
    appInfoError,
    appInfoLoading,
    appData,
    appPrevChatList,
    showConfigPanelBeforeChat,
    appChatListDataLoading,
    handleNewConversation,
    themeBuilder,
  } = useEmbeddedChatbotContext()

  const chatReady = (!showConfigPanelBeforeChat || !!appPrevChatList.length)
  const customConfig = appData?.custom_config
  const site = appData?.site

  const difyIcon = <LogoHeader />

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
    <div>
      <Header
        isMobile={isMobile}
        title={site?.title || ''}
        customerIcon={isDify() ? difyIcon : ''}
        theme={themeBuilder?.theme}
        onCreateNewChat={handleNewConversation}
      />
      <div className='flex bg-white overflow-hidden'>
        <div className={cn('h-[100vh] grow flex flex-col overflow-y-auto', isMobile && '!h-[calc(100vh_-_3rem)]')}>
          {showConfigPanelBeforeChat && !appChatListDataLoading && !appPrevChatList.length && (
            <div className={cn('flex w-full items-center justify-center h-full tablet:px-4', isMobile && 'px-4')}>
              <ConfigPanel />
            </div>
          )}
          {appChatListDataLoading && chatReady && (
            <Loading type='app' />
          )}
          {chatReady && !appChatListDataLoading && (
            <div className='relative h-full pt-8 mx-auto w-full max-w-[720px]'>
              {!isMobile && (
                <div className='absolute top-2.5 right-3 z-20'>
                  <Tooltip
                    popupContent={t('share.chat.resetChat')}
                  >
                    <div className='p-1.5 bg-white border-[0.5px] border-gray-100 rounded-lg shadow-md cursor-pointer' onClick={handleNewConversation}>
                      <RiLoopLeftLine className="h-4 w-4 text-gray-500"/>
                    </div>
                  </Tooltip>
                </div>
              )}
              <ChatWrapper />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const EmbeddedChatbotWrapper = () => {
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
    handleNewConversationCompleted,
    chatShouldReloadKey,
    isInstalledApp,
    appId,
    handleFeedback,
    currentChatInstanceRef,
  } = useEmbeddedChatbot()

  return <EmbeddedChatbotContext.Provider value={{
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
    handleNewConversationCompleted,
    chatShouldReloadKey,
    isMobile,
    isInstalledApp,
    appId,
    handleFeedback,
    currentChatInstanceRef,
    themeBuilder,
  }}>
    <Chatbot />
  </EmbeddedChatbotContext.Provider>
}

const EmbeddedChatbot = () => {
  const [initialized, setInitialized] = useState(false)
  const [appUnavailable, setAppUnavailable] = useState<boolean>(false)
  const [isUnknownReason, setIsUnknownReason] = useState<boolean>(false)

  useAsyncEffect(async () => {
    if (!initialized) {
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
      setInitialized(true)
    }
  }, [])

  if (!initialized)
    return null

  if (appUnavailable)
    return <AppUnavailable isUnknownReason={isUnknownReason} />

  return <EmbeddedChatbotWrapper />
}

export default EmbeddedChatbot
