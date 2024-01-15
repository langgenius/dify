import type { FC } from 'react'
import {
  useEffect,
  useRef,
} from 'react'
import type { ChatItem } from '../types'
import Question from './question'
import Answer from './answer'

type ConversationProps = {
  chatList: ChatItem[]
  className?: string
}
const Conversation: FC<ConversationProps> = ({
  chatList,
  className,
}) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // scroll to bottom
    if (ref.current)
      ref.current.scrollTop = ref.current.scrollHeight
  }, [chatList])

  return (
    <div
      className={`grow overflow-y-auto ${className}`}
      ref={ref}
    >
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
