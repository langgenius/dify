import {
  useEffect,
  useState,
} from 'react'
import { useAsyncEffect } from 'ahooks'
import { useTranslation } from 'react-i18next'
import {
  EmbeddedChatbotContext,
  useEmbeddedChatbotContext,
} from './context'
import { useEmbeddedChatbot } from './hooks'
import { isDify } from './utils'
import { useThemeContext } from './theme/theme-context'
import { CssTransform } from './theme/utils'
import { checkOrSetAccessToken } from '@/app/components/share/utils'
import AppUnavailable from '@/app/components/base/app-unavailable'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import LogoHeader from '@/app/components/base/logo/logo-embedded-chat-header'
import Header from '@/app/components/base/chat/embedded-chatbot/header'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import LogoSite from '@/app/components/base/logo/logo-site'
import cn from '@/utils/classnames'

const Chatbot = () => {
  const {
    isMobile,
    appInfoError,
    appInfoLoading,
    appData,
    appChatListDataLoading,
    chatShouldReloadKey,
    handleNewConversation,
    themeBuilder,
  } = useEmbeddedChatbotContext()
  const { t } = useTranslation()

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
      <>
        {!isMobile && <Loading type='app' />}
        {isMobile && (
          <div className={cn('relative')}>
            <div className={cn('flex flex-col h-[calc(100vh_-_60px)] border-[0.5px] border-components-panel-border rounded-2xl shadow-xs')}>
              <Loading type='app' />
            </div>
          </div>
        )}
      </>
    )
  }

  if (appInfoError) {
    return (
      <>
        {!isMobile && <AppUnavailable />}
        {isMobile && (
          <div className={cn('relative')}>
            <div className={cn('flex flex-col h-[calc(100vh_-_60px)] border-[0.5px] border-components-panel-border rounded-2xl shadow-xs')}>
              <AppUnavailable />
            </div>
          </div>
        )}
      </>
    )
  }
  return (
    <div className='relative'>
      <div
        className={cn(
          'flex flex-col border border-components-panel-border-subtle rounded-2xl',
          isMobile ? 'h-[calc(100vh_-_60px)] border-[0.5px] border-components-panel-border shadow-xs' : 'h-[100vh] bg-chatbot-bg',
        )}
        style={isMobile ? Object.assign({}, CssTransform(themeBuilder?.theme?.backgroundHeaderColorStyle ?? '')) : {}}
      >
        <Header
          isMobile={isMobile}
          title={site?.title || ''}
          customerIcon={isDify() ? difyIcon : ''}
          theme={themeBuilder?.theme}
          onCreateNewChat={handleNewConversation}
        />
        <div className={cn('grow flex flex-col overflow-y-auto', isMobile && '!h-[calc(100vh_-_3rem)] bg-chatbot-bg rounded-2xl')}>
          {appChatListDataLoading && (
            <Loading type='app' />
          )}
          {!appChatListDataLoading && (
            <ChatWrapper key={chatShouldReloadKey} />
          )}
        </div>
      </div>
      {/* powered by */}
      {isMobile && (
        <div className='shrink-0 h-[60px] pl-2 flex items-center'>
          {!appData?.custom_config?.remove_webapp_brand && (
            <div className={cn(
              'shrink-0 px-2 flex items-center gap-1.5',
            )}>
              <div className='text-text-tertiary system-2xs-medium-uppercase'>{t('share.chat.poweredBy')}</div>
              {appData?.custom_config?.replace_webapp_logo && (
                <img src={appData?.custom_config?.replace_webapp_logo} alt='logo' className='block w-auto h-5' />
              )}
              {!appData?.custom_config?.replace_webapp_logo && (
                <LogoSite className='!h-5' />
              )}
            </div>
          )}
        </div>
      )}
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
    newConversationInputs,
    newConversationInputsRef,
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
    newConversationInputs,
    newConversationInputsRef,
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
