import type { FC } from 'react'
import type { ConversationItem } from '@/models/share'
import Item from './item'

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
    <div className="space-y-0.5">
      {title && (
        <div className="system-xs-medium-uppercase px-3 pb-1 pt-2 text-text-tertiary">{title}</div>
      )}
      {list.map(item => (
        <Item
          key={item.id}
          isPin={isPin}
          item={item}
          onOperate={onOperate}
          onChangeConversation={onChangeConversation}
          currentConversationId={currentConversationId}
        />
      ))}
    </div>
  )
}

export default List
