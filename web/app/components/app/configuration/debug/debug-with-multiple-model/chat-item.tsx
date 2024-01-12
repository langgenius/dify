import type { FC } from 'react'
import type { ModelAndParameter } from '../types'
import Dropdown from './dropdown'
import type { ChatConfig } from '@/app/components/base/chat/types'
import { Chat } from '@/app/components/base/chat'
import { useChat } from '@/app/components/base/chat/hooks'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useDebugConfigurationContext } from '@/context/debug-configuration'

type ChatItemProps = {
  index: number
  modelAndParameter: ModelAndParameter
  className?: string
}
const ChatItem: FC<ChatItemProps> = ({
  index,
  modelAndParameter,
  className,
}) => {
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
  const { eventEmitter } = useEventEmitterContextContext()
  const {
    chatList,
    conversationId,
    handleSend,
  } = useChat(config)

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
    <div className={`min-w-[320px] rounded-xl bg-white border-[0.5px] border-black/5 ${className}`}>
      <div className='flex items-center justify-between h-10 px-3 border-b-[0.5px] border-b-black/5'>
        <div className='flex items-center justify-center w-6 h-5 font-medium italic text-gray-500'>
          #{index + 1}
        </div>
        <Dropdown onSelect={() => {}} />
      </div>
      <Chat
        config={config}
        chatList={chatList}
        noChatInput
      />
    </div>
  )
}

export default ChatItem
