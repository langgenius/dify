import type { FC } from 'react'
import { memo } from 'react'
import type { ChatItem } from '../types'
import { useChatContext } from '../context'
import Question from './question'
import Answer from './answer'

type ConversationProps = {
  chatList: ChatItem[]
}
const Conversation: FC<ConversationProps> = ({
  chatList,
}) => {
  const { isResponsing } = useChatContext()

  return (
    <div>
      {
        chatList.map((item) => {
          if (item.isAnswer) {
            const isLast = item.id === chatList[chatList.length - 1]?.id
            return (
              <Answer
                key={item.id}
                item={item}
                responsing={isLast && isResponsing}
              />
            )
          }
          return (
            <Question
              key={item.id}
              item={item}
            />
          )
        })
      }
    </div>
  )
}

export default memo(Conversation)
