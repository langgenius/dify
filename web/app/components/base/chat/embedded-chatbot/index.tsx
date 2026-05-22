'use client'
import type { AppData } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import ChatWrapper from '@/app/components/base/chat/embedded-chatbot/chat-wrapper'
import Header from '@/app/components/base/chat/embedded-chatbot/header'
import Loading from '@/app/components/base/loading'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { AppSourceType } from '@/service/share'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { EmbeddedChatbotContext,
  useEmbeddedChatbotContext,
} from './context'
import { useEmbeddedChatbot } from './hooks'
import { useThemeContext } from './theme/theme-context'
import { CssTransform } from './theme/utils'

const Chatbot = () => {
  const {
    isMobile,
    allowResetChat,
    appData,
    appChatListDataLoading,
    chatShouldReloadKey,
    handleNewConversation,
    themeBuilder,
  } = useEmbeddedChatbotContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const site = appData?.site

  useDocumentTitle(site?.title || 'Chat')

  return (
    <div className="relative">
      <div
        className={cn(
          'flex flex-col rounded-2xl',
          isMobile ? 'h-[calc(100vh-60px)] shadow-xs' : 'h-screen bg-chatbot-bg',
        )}
        style={isMobile ? Object.assign({}, CssTransform(themeBuilder?.theme?.backgroundHeaderColorStyle ?? '')) : {}}
      >
        <Header
          isMobile={isMobile}
          allowResetChat={allowResetChat}
          title={site?.title || ''}
          customerIcon=""
          theme={themeBuilder?.theme}
          onCreateNewChat={handleNewConversation}
        />
        <div className={cn('flex grow flex-col overflow-y-auto', isMobile && 'm-[0.5px] h-[calc(100vh-3rem)]! rounded-2xl bg-chatbot-bg')}>
          {appChatListDataLoading && (
            <Loading type="app" />
          )}
          {!appChatListDataLoading && (
            <ChatWrapper key={chatShouldReloadKey} />
          )}
        </div>
      </div>
      {/* powered by */}
      {isMobile && !appData?.custom_config?.remove_webapp_brand && (
        <div className="flex h-[60px] shrink-0 items-center pl-2">
          <div className="flex shrink-0 items-center gap-1.5 px-2">
            {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
              ? <img src={systemFeatures.branding.workspace_logo} alt="logo" className="block h-5 w-auto" />
              : appData?.custom_config?.replace_webapp_logo
                ? <img src={`${appData?.custom_config?.replace_webapp_logo}`} alt="logo" className="block h-5 w-auto" />
                : null}
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
  } = useEmbeddedChatbot(AppSourceType.webApp)

  return (
    <EmbeddedChatbotContext.Provider value={{
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
    }}
    >
      <Chatbot />
    </EmbeddedChatbotContext.Provider>
  )
}

const EmbeddedChatbot = () => {
  return <EmbeddedChatbotWrapper />
}

export default EmbeddedChatbot
