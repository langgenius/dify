import type { FC } from 'react'
import type { ChatItem } from '../types'
import Question from './question'
import Answer from './answer'

type ConversationProps = {
  chatList: ChatItem[]
}
const Conversation: FC<ConversationProps> = ({
  chatList,
}) => {
  return (
    <div>
      {
        chatList.map((item) => {
          if (item.isAnswer) {
            return (
              <Answer
                key={item.id}
                item={item}
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

export default Conversation
