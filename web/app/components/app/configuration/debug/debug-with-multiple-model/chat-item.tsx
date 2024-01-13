import { Chat } from '@/app/components/base/chat'
import { useChat } from '@/app/components/base/chat/hooks'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import type { ChatConfig } from '@/app/components/base/chat/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'

const ChatItem = () => {
  const {
    appId,
    inputs,
    speechToTextConfig,
    introduction,
    moreLikeThisConfig,
  } = useDebugConfigurationContext()
  const config: ChatConfig = {
    speech_to_text: speechToTextConfig,
    opening_statement: introduction,
    suggested_questions_after_answer: moreLikeThisConfig,
  }
  const {
    chatList,
    conversationId,
    handleSend,
  } = useChat(config)

  const { eventEmitter } = useEventEmitterContextContext()
  eventEmitter?.useSubscription((v: any) => {
    if (v.type === 'app-chat-with-multiple-model') {
      handleSend(
        `apps/${appId}/chat-messages`,
        {
          query: v.payload.message,
          conversation_id: conversationId,
          inputs,
          model_config: config,
        },
      )
    }
  })

  return (
    <div>
      <Chat
        config={config}
        chatList={chatList}
        noChatInput
      />
    </div>
  )
}

export default ChatItem
