import type { FC } from 'react'
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

type ChatWithHistoryProps = {
  className?: string
}
const ChatWithHistory: FC<ChatWithHistoryProps> = ({
  className,
}) => {
  const {
    showConfigPanelBeforeChat,
    appChatListDataLoading,
    chatShouldReloadKey,
    isMobile,
  } = useChatWithHistoryContext()

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
      <div className={`grow overflow-hidden ${showConfigPanelBeforeChat && 'flex items-center justify-center'}`}>
        {
          showConfigPanelBeforeChat && (
            <div className={`flex w-full items-center justify-center h-full ${isMobile && 'px-4'}`}>
              <ConfigPanel />
            </div>
          )
        }
        {
          appChatListDataLoading && (
            <Loading type='app' />
          )
        }
        {
          !showConfigPanelBeforeChat && !appChatListDataLoading && (
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

  const {
    appData,
    appParams,
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
  } = useChatWithHistory(installedAppInfo)

  return (
    <ChatWithHistoryContext.Provider value={{
      appData,
      appParams,
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
    }}>
      <ChatWithHistory className={className} />
    </ChatWithHistoryContext.Provider>
  )
}

export default ChatWithHistoryWrap
