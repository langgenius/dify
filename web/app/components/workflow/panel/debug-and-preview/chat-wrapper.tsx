import Chat from '@/app/components/base/chat/chat'
import { useChat } from '@/app/components/base/chat/chat/hooks'

const ChatWrapper = () => {
  const {
    handleStop,
    isResponsing,
    suggestedQuestions,
  } = useChat()

  return (
    <Chat
      chatList={[]}
      isResponsing={isResponsing}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='px-4'
      chatFooterClassName='pb-4'
      chatFooterInnerClassName='px-4'
      onSend={() => {}}
      onStopResponding={handleStop}
      chatNode={(
        <div className='h-[150px] rounded-xl bg-white shadow-xs'></div>
      )}
      allToolIcons={{}}
      suggestedQuestions={suggestedQuestions}
    />
  )
}

export default ChatWrapper
