'use client'
import {
  useEffect,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  EmbeddedChatbotContext,
  useEmbeddedChatbotContext,
} from './context'
import { useEmbeddedChatbot } from './hooks'
import { isDify } from './utils'
import { useThemeContext } from './theme/theme-context'
import { CssTransform } from './theme/utils'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Loading from '@/app/components/base/loading'
import LogoHeader from '@/app/components/base/logo/logo-embedded-chat-header'
import Header from '@/app/components/base/chat/embedded-chatbot/header'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import MemoryPanel from '@/app/components/base/chat/chat-with-history/memory'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import cn from '@/utils/classnames'
import useDocumentTitle from '@/hooks/use-document-title'
import { useGlobalPublicStore } from '@/context/global-public-context'

const Chatbot = () => {
  const {
    isMobile,
    allowResetChat,
    appData,
    appChatListDataLoading,
    chatShouldReloadKey,
    handleNewConversation,
    themeBuilder,
    showChatMemory,
    setShowChatMemory,
    memoryList,
    clearAllMemory,
    updateMemory,
    resetDefault,
    clearAllUpdateVersion,
    switchMemoryVersion,
  } = useEmbeddedChatbotContext()
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  const customConfig = appData?.custom_config
  const site = appData?.site

  const difyIcon = <LogoHeader />

  useEffect(() => {
    themeBuilder?.buildTheme(site?.chat_color_theme, site?.chat_color_theme_inverted)
  }, [site, customConfig, themeBuilder])

  useDocumentTitle(site?.title || 'Chat')

  return (
    <div className='relative'>
      <div
        className={cn(
          'flex flex-col rounded-2xl border border-components-panel-border-subtle',
          isMobile ? 'h-[calc(100vh_-_60px)] border-[0.5px] border-components-panel-border shadow-xs' : 'h-[100vh] bg-chatbot-bg',
        )}
        style={isMobile ? Object.assign({}, CssTransform(themeBuilder?.theme?.backgroundHeaderColorStyle ?? '')) : {}}
      >
        <Header
          isMobile={isMobile}
          allowResetChat={allowResetChat}
          title={site?.title || ''}
          customerIcon={isDify() ? difyIcon : ''}
          theme={themeBuilder?.theme}
          onCreateNewChat={handleNewConversation}
        />
        <div className={cn('flex grow flex-col overflow-y-auto', isMobile && '!h-[calc(100vh_-_3rem)] rounded-2xl bg-chatbot-bg')}>
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
        <div className='flex h-[60px] shrink-0 items-center pl-2'>
          {!appData?.custom_config?.remove_webapp_brand && (
            <div className={cn(
              'flex shrink-0 items-center gap-1.5 px-2',
            )}>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{t('share.chat.poweredBy')}</div>
              {
                systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
                  ? <img src={systemFeatures.branding.workspace_logo} alt='logo' className='block h-5 w-auto' />
                  : appData?.custom_config?.replace_webapp_logo
                    ? <img src={`${appData?.custom_config?.replace_webapp_logo}`} alt='logo' className='block h-5 w-auto' />
                    : <DifyLogo size='small' />
              }
            </div>
          )}
        </div>
      )}
      {showChatMemory && (
        <div className='fixed inset-0 z-50 flex flex-row-reverse bg-background-overlay p-1 backdrop-blur-sm'
          onClick={() => setShowChatMemory(false)}
        >
          <div className='flex h-full w-[360px] rounded-xl shadow-lg' onClick={e => e.stopPropagation()}>
            <MemoryPanel
              isMobile={isMobile}
              showChatMemory={showChatMemory}
              setShowChatMemory={setShowChatMemory}
              memoryList={memoryList}
              clearAllMemory={clearAllMemory}
              updateMemory={updateMemory}
              resetDefault={resetDefault}
              clearAllUpdateVersion={clearAllUpdateVersion}
              switchMemoryVersion={switchMemoryVersion}
            />
          </div>
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
    appData,
    userCanAccess,
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
    allowResetChat,
    appId,
    handleFeedback,
    currentChatInstanceRef,
    clearChatList,
    setClearChatList,
    isResponding,
    setIsResponding,
    currentConversationInputs,
    setCurrentConversationInputs,
    allInputsHidden,
    initUserVariables,
    showChatMemory,
    setShowChatMemory,
    memoryList,
    clearAllMemory,
    updateMemory,
    resetDefault,
    clearAllUpdateVersion,
    switchMemoryVersion,
  } = useEmbeddedChatbot()

  return <EmbeddedChatbotContext.Provider value={{
    userCanAccess,
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
    allowResetChat,
    appId,
    handleFeedback,
    currentChatInstanceRef,
    themeBuilder,
    clearChatList,
    setClearChatList,
    isResponding,
    setIsResponding,
    currentConversationInputs,
    setCurrentConversationInputs,
    allInputsHidden,
    initUserVariables,
    showChatMemory,
    setShowChatMemory,
    memoryList,
    clearAllMemory,
    updateMemory,
    resetDefault,
    clearAllUpdateVersion,
    switchMemoryVersion,
  }}>
    <Chatbot />
  </EmbeddedChatbotContext.Provider>
}

const EmbeddedChatbot = () => {
  return <EmbeddedChatbotWrapper />
}

export default EmbeddedChatbot
