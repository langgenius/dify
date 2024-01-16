import type { FC } from 'react'
import {
  useEffect,
  useRef,
} from 'react'
import Conversation from './conversation'
import ChatInput from './chat-input'
import TryToAsk from './try-to-ask'
import type {
  ChatConfig,
  ChatItem,
  OnSend,
} from './types'
import { ChatContextProvider } from './context'
import { INITIAL_CONFIG } from './constants'

type ChatProps = {
  config: ChatConfig
  onSend?: OnSend
  chatList: ChatItem[]
  isResponsing: boolean
  noChatInput?: boolean
  className?: string
  suggestedQuestions?: string[]
}
const Chat: FC<ChatProps> = ({
  config = INITIAL_CONFIG,
  onSend,
  chatList,
  isResponsing,
  noChatInput,
  className,
  suggestedQuestions,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scroll to bottom
    if (ref.current)
      ref.current.scrollTop = ref.current.scrollHeight
  }, [chatList])

  return (
    <ChatContextProvider
      config={config}
      isResponsing={isResponsing}
    >
      <div
        ref={ref}
        className={`relative h-full overflow-y-auto ${className}`}
      >
        <Conversation
          chatList={chatList}
        />
        <div className='sticky -bottom-4 w-full bg-white'>
          {
            config.suggested_questions_after_answer?.enabled && !!suggestedQuestions?.length && onSend && (
              <TryToAsk
                suggestedQuestions={suggestedQuestions}
                onSend={onSend}
              />
            )
          }
          {
            !noChatInput && (
              <ChatInput
                visionConfig={config?.file_upload?.image}
                speechToTextConfig={config.speech_to_text}
                onSend={onSend}
              />
            )
          }
        </div>
      </div>
    </ChatContextProvider>
  )
}

export default Chat
