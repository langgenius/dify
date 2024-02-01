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

type ChatWithHistoryProps = {
  className?: string
}
const ChatWithHistory: FC<ChatWithHistoryProps> = ({
  className,
}) => {
  const {
    currentConversationId,
    showConfigPanel,
    appChatListDataLoading,
  } = useChatWithHistoryContext()

  return (
    <div className={`h-full flex bg-white ${className}`}>
      <Sidebar />
      <div className={`grow overflow-hidden ${showConfigPanel && 'flex items-center justify-center'}`}>
        {
          showConfigPanel && (
            <ConfigPanel />
          )
        }
        {
          !showConfigPanel && !appChatListDataLoading && (
            <ChatWrapper key={currentConversationId} />
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
    handleCurrentConversationIdChange,
    appPrevChatList,
    pinnedConversationList,
    conversationList,
    showConfigPanel,
    setShowConfigPanel,
    setShowNewConversationItemInList,
    newConversationInputs,
    setNewConversationInputs,
    inputsForms,
    handleNewConversation,
    handleStartChat,
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
      handleCurrentConversationIdChange,
      appPrevChatList,
      pinnedConversationList,
      conversationList,
      showConfigPanel,
      setShowConfigPanel,
      setShowNewConversationItemInList,
      newConversationInputs,
      setNewConversationInputs,
      inputsForms,
      handleNewConversation,
      handleStartChat,
    }}>
      <ChatWithHistory className={className} />
    </ChatWithHistoryContext.Provider>
  )
}

export default ChatWithHistoryWrap
