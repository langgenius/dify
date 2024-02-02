import type { FC } from 'react'
import {
  ChatWithHistoryContext,
  useChatWithHistoryContext,
} from './context'
import { useChatWithHistory } from './hooks'
import Sidebar from './sidebar'
import ConfigPanel from './config-panel'
import ChatWrapper from './chat-wrapper'
import type { InstalledApp } from '@/models/explore'
import Loading from '@/app/components/base/loading'

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
  } = useChatWithHistoryContext()

  return (
    <div className={`h-full flex bg-white ${className}`}>
      <Sidebar />
      <div className={`grow overflow-hidden ${showConfigPanelBeforeChat && 'flex items-center justify-center'}`}>
        {
          showConfigPanelBeforeChat && (
            <ConfigPanel />
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
  const {
    appData,
    appMeta,
    appParams,
    appPinnedConversationData,
    appConversationData,
    appChatListData,
    appChatListDataLoading,
    currentConversationId,
    currentConversationItem,
    handleConversationIdInfoChange,
    appPrevChatList,
    pinnedConversationList,
    conversationList,
    showConfigPanelBeforeChat,
    setShowConfigPanelBeforeChat,
    setShowNewConversationItemInList,
    newConversationInputs,
    handleNewConversationInputsChange,
    inputsForms,
    handleNewConversation,
    handleStartChat,
    handleChangeConversation,
    handlePinConversation,
    handleUnpinConversation,
    conversationDeleting,
    handleDeleteConversation,
    conversationRenaming,
    handleRenameConversation,
    handleNewConversationCompleted,
    newConversationId,
    chatShouldReloadKey,
  } = useChatWithHistory(installedAppInfo)

  return (
    <ChatWithHistoryContext.Provider value={{
      installedAppInfo,
      appData,
      appMeta,
      appParams,
      appPinnedConversationData,
      appConversationData,
      appChatListData,
      appChatListDataLoading,
      currentConversationId,
      currentConversationItem,
      handleConversationIdInfoChange,
      appPrevChatList,
      pinnedConversationList,
      conversationList,
      showConfigPanelBeforeChat,
      setShowConfigPanelBeforeChat,
      setShowNewConversationItemInList,
      newConversationInputs,
      handleNewConversationInputsChange,
      inputsForms,
      handleNewConversation,
      handleStartChat,
      handleChangeConversation,
      handlePinConversation,
      handleUnpinConversation,
      conversationDeleting,
      handleDeleteConversation,
      conversationRenaming,
      handleRenameConversation,
      handleNewConversationCompleted,
      newConversationId,
      chatShouldReloadKey,
    }}>
      <ChatWithHistory className={className} />
    </ChatWithHistoryContext.Provider>
  )
}

export default ChatWithHistoryWrap
