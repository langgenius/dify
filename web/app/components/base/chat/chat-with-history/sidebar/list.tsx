import type { FC } from 'react'
import Item from './item'
import type { ConversationItem } from '@/models/share'

type ListProps = {
  isPin?: boolean
  title?: string
  list: ConversationItem[]
  onOperate: (type: string, item: ConversationItem) => void
  onChangeConversation: (conversationId: string) => void
  currentConversationId: string
}
const List: FC<ListProps> = ({
  isPin,
  title,
  list,
  onOperate,
  onChangeConversation,
  currentConversationId,
}) => {
  return (
    <div>
      {
        title && (
          <div className='mb-0.5 h-[26px] px-3 text-xs font-medium text-gray-500'>
            {title}
          </div>
        )
      }
      {
        list.map(item => (
          <Item
            key={item.id}
            isPin={isPin}
            item={item}
            onOperate={onOperate}
            onChangeConversation={onChangeConversation}
            currentConversationId={currentConversationId}
          />
        ))
      }
    </div>
  )
}

export default List
