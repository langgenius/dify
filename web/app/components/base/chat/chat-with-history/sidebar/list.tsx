import type { FC } from 'react'
import { useChatWithHistoryContext } from '../context'
import type { ConversationItem } from '@/models/share'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'

type ListProps = {
  title?: string
  list: ConversationItem[]
}
const List: FC<ListProps> = ({
  title,
  list,
}) => {
  const {
    currentConversationId,
    handleCurrentConversationIdChange,
    setShowConfigPanel,
  } = useChatWithHistoryContext()

  return (
    <div>
      {
        title && (
          <div className='mb-0.5 px-3 h-[26px] text-xs font-medium text-gray-500'>
            {title}
          </div>
        )
      }
      {
        list.map(item => (
          <div
            key={item.id}
            className={`
              flex mb-0.5 last-of-type:mb-0 py-2 pl-3 pr-1.5 text-sm font-medium text-gray-700 
              rounded-lg cursor-pointer hover:bg-gray-50
              ${currentConversationId === item.id && 'text-primary-600 bg-primary-50'}
            `}
            onClick={() => {
              handleCurrentConversationIdChange(item.id)
              setShowConfigPanel(false)
            }}
          >
            <MessageDotsCircle className={`shrink-0 mt-0.5 mr-2 w-4 h-4 text-gray-400 ${currentConversationId === item.id && 'text-primary-600'}`} />
            <div>{item.name}</div>
          </div>
        ))
      }
    </div>
  )
}

export default List
