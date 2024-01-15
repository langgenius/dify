import type { FC } from 'react'
import Conversation from './conversation'
import InputArea from './input-area'
import type {
  ChatConfig,
  ChatItem,
  VisionFile,
} from './types'
import { ChatContextProvider } from './context'
import { INITIAL_CONFIG } from './constants'

type ChatProps = {
  config: ChatConfig
  onSend?: (message: string, files?: VisionFile[]) => void
  chatList: ChatItem[]
  noChatInput?: boolean
  conversationClassName?: string
}
const Chat: FC<ChatProps> = ({
  config = INITIAL_CONFIG,
  onSend,
  chatList,
  noChatInput,
  conversationClassName,
}) => {
  return (
    <ChatContextProvider config={config}>
      <div className='flex flex-col h-full'>
        <Conversation
          chatList={chatList}
          className={conversationClassName}
        />
        <InputArea
          noChatInput={noChatInput}
          onSend={onSend}
        />
      </div>
    </ChatContextProvider>
  )
}

export default Chat
