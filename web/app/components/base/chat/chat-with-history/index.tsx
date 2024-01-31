import type { FC } from 'react'
import Chat from '../chat'
import { useChat } from '../chat/hooks'
import {
  ChatWithHistoryContext,
  useChatWithHistoryContext,
} from './context'
import { useChatWithHistory } from './hooks'
import Header from './header'
import type { InstalledApp } from '@/models/explore'

const ChatWithHistory = () => {
  const { appData, appMeta, appParams, appConversationData } = useChatWithHistoryContext()
  const {
    chatList,
  } = useChat(appParams)

  return (
    <div className='flex bg-white rounded-t-2xl'>
      <div className='grow flex flex-col'>
        <Header />
        <div className='grow'>
          <Chat
            chatList={chatList}
          />
        </div>
      </div>
    </div>
  )
}

export type ChatWithHistoryWrapProps = {
  installedAppInfo?: InstalledApp
}
const ChatWithHistoryWrap: FC<ChatWithHistoryWrapProps> = ({
  installedAppInfo,
}) => {
  const {
    appData,
    appMeta,
    appParams,
    appConversationData,
  } = useChatWithHistory(installedAppInfo)

  return (
    <ChatWithHistoryContext.Provider value={{
      appData,
      appMeta,
      appParams,
      appConversationData,
    }}>
      <ChatWithHistory />
    </ChatWithHistoryContext.Provider>
  )
}

export default ChatWithHistoryWrap
