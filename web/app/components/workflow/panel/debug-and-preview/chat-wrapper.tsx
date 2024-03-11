import {
  memo,
  useCallback,
} from 'react'
import { useStore } from '../../store'
import UserInput from './user-input'
import { useChat } from './hooks'
import Chat from '@/app/components/base/chat/chat'
import type { OnSend } from '@/app/components/base/chat/types'

const ChatWrapper = () => {
  const {
    conversationId,
    chatList,
    handleStop,
    isResponding,
    suggestedQuestions,
    handleSend,
  } = useChat()

  const doSend = useCallback<OnSend>((query, files) => {
    handleSend({
      query,
      files,
      inputs: useStore.getState().inputs,
      conversationId,
    })
  }, [conversationId, handleSend])

  return (
    <Chat
      chatList={chatList}
      isResponding={isResponding}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='pt-6'
      chatFooterClassName='px-4'
      chatFooterInnerClassName='pb-4'
      onSend={doSend}
      onStopResponding={handleStop}
      chatNode={<UserInput />}
      allToolIcons={{}}
      suggestedQuestions={suggestedQuestions}
    />
  )
}

export default memo(ChatWrapper)
