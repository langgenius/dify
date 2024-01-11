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
}
const Chat: FC<ChatProps> = ({
  config = INITIAL_CONFIG,
  onSend,
  chatList,
}) => {
  return (
    <ChatContextProvider config={config}>
      <div>
        <Conversation
          chatList={chatList}
        />
        <InputArea
          onSend={onSend}
        />
      </div>
    </ChatContextProvider>
  )
}

export default Chat
