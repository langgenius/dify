import { memo } from 'react'
import UserInput from './debug-and-preview/user-input'
import Chat from '@/app/components/base/chat/chat'

const ChatRecord = () => {
  return (
    <Chat
      config={{} as any}
      chatList={[]}
      chatContainerclassName='px-4'
      chatContainerInnerClassName='pt-6'
      chatFooterClassName='px-4 rounded-b-2xl'
      chatFooterInnerClassName='pb-4'
      chatNode={<UserInput />}
      allToolIcons={{}}
    />
  )
}

export default memo(ChatRecord)
