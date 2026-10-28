'use client'
import type { AppData } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import Header from '@/app/components/base/chat/embedded-chatbot/header'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import LogoHeader from '@/app/components/base/logo/logo-embedded-chat-header'
import { WebAppConnectionsProvider } from '@/app/components/share/connections/connection-provider'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { AppSourceType } from '@/service/share'
import { resolveWebAppAddress } from '@/service/webapp-address'
import { EmbeddedChatbotContext, useEmbeddedChatbotContext } from './context'
import { useEmbeddedChatbot } from './hooks'
import { createTheme } from './theme/theme'
import { CssTransform } from './theme/utils'
import { isDify } from './utils'

const Chatbot = () => {
  const {
    isMobile,
    allowResetChat,
    appData,
    appChatListDataLoading,
    chatShouldReloadKey,
    conversationSession,
    handleNewConversation,
    theme,
  } = useEmbeddedChatbotContext()
  const { t } = useTranslation(['share'])
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  const site = appData?.site

  const difyIcon = <LogoHeader />

  useDocumentTitle(site?.title || 'Chat')

  return (
    <div className="relative">
      <div
        className={cn(
          'flex flex-col rounded-2xl',
          isMobile ? 'h-[calc(100vh-60px)] shadow-xs' : 'h-screen bg-chatbot-bg',
        )}
        style={
          isMobile ? Object.assign({}, CssTransform(theme?.backgroundHeaderColorStyle ?? '')) : {}
        }
      >
        <Header
          isMobile={isMobile}
          allowResetChat={allowResetChat}
          title={site?.title || ''}
          customerIcon={isDify() ? difyIcon : ''}
          theme={theme}
          onCreateNewChat={handleNewConversation}
        />
        <div
          className={cn(
            'flex grow flex-col overflow-y-auto',
            isMobile && 'm-[0.5px] h-[calc(100vh-3rem)]! rounded-2xl bg-chatbot-bg',
          )}
        >
          {appChatListDataLoading && <LoadingPlaceholder className="h-full" />}
          {!appChatListDataLoading && (
            <ChatWrapper key={JSON.stringify([chatShouldReloadKey, conversationSession])} />
          )}
        </div>
      </div>
      {/* powered by */}
      {isMobile && (
        <div className="flex h-15 shrink-0 items-center ps-2">
          {!appData?.custom_config?.remove_webapp_brand && (
            <div className={cn('flex shrink-0 items-center gap-1.5 px-2')}>
              <div className="system-2xs-medium-uppercase text-text-tertiary">
                {t(($) => $['chat.poweredBy'], { ns: 'share' })}
              </div>
              {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo ? (
                <img
                  src={systemFeatures.branding.workspace_logo}
                  alt="logo"
                  className="block h-5 w-auto"
                />
              ) : appData?.custom_config?.replace_webapp_logo ? (
                <img
                  src={`${appData?.custom_config?.replace_webapp_logo}`}
                  alt="logo"
                  className="block h-5 w-auto"
                />
              ) : (
                <DifyLogo alt="Dify" size="small" />
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

  const {
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
    conversationSession,
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
  } = useEmbeddedChatbot(AppSourceType.webApp)
  const theme = createTheme(
    appData?.site?.chat_color_theme ?? null,
    appData?.site?.chat_color_theme_inverted ?? false,
  )

  const address = resolveWebAppAddress()
  const chat = <Chatbot />
  const supportsConnections = appData?.mode === 'advanced-chat' && address?.kind === 'default'

  return (
    <EmbeddedChatbotContext.Provider
      value={{
        appSourceType: AppSourceType.webApp,
        appData: (appData as AppData) || null,
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
        conversationSession: supportsConnections ? conversationSession : undefined,
        isMobile,
        isInstalledApp,
        allowResetChat,
        appId,
        handleFeedback,
        currentChatInstanceRef,
        theme,
        clearChatList,
        setClearChatList,
        isResponding,
        setIsResponding,
        currentConversationInputs,
        setCurrentConversationInputs,
        allInputsHidden,
        initUserVariables,
      }}
    >
      {supportsConnections ? (
        <WebAppConnectionsProvider
          address={address}
          conversationId={currentConversationId || undefined}
          selectionSession={conversationSession}
        >
          {chat}
        </WebAppConnectionsProvider>
      ) : (
        chat
      )}
    </EmbeddedChatbotContext.Provider>
  )
}

const EmbeddedChatbot = () => {
  return <EmbeddedChatbotWrapper />
}

export default EmbeddedChatbot
