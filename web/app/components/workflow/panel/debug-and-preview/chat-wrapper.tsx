import UserInput from './user-input'
import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'

const ChatWrapper = () => {
  const {
    handleStop,
    isResponding,
    suggestedQuestions,
  } = useChat()

  return (
    <Chat
      chatList={[]}
      isResponding={isResponding}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='px-4'
      chatFooterClassName='pb-4'
      chatFooterInnerClassName='px-4'
      onSend={() => {}}
      onStopResponding={handleStop}
      chatNode={<UserInput />}
      allToolIcons={{}}
      suggestedQuestions={suggestedQuestions}
    />
  )
}

export default ChatWrapper
