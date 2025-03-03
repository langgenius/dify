import type { FC } from 'react'
import {
  memo,
  useRef,
} from 'react'
import { useHover } from 'ahooks'
import type { ConversationItem } from '@/models/share'
import Operation from '@/app/components/base/chat/chat-with-history/sidebar/operation'
import cn from '@/utils/classnames'

type ItemProps = {
  isPin?: boolean
  item: ConversationItem
  onOperate: (type: string, item: ConversationItem) => void
  onChangeConversation: (conversationId: string) => void
  currentConversationId: string
}
const Item: FC<ItemProps> = ({
  isPin,
  item,
  onOperate,
  onChangeConversation,
  currentConversationId,
}) => {
  const ref = useRef(null)
  const isHovering = useHover(ref)
  const isSelected = currentConversationId === item.id

  return (
    <div
      ref={ref}
      key={item.id}
      className={cn(
        'group flex p-1 pl-3 rounded-lg cursor-pointer text-components-menu-item-text system-sm-medium hover:bg-state-base-hover',
        isSelected && 'bg-state-accent-active hover:bg-state-accent-active text-text-accent',
      )}
      onClick={() => onChangeConversation(item.id)}
    >
      <div className='grow p-1 pl-0 truncate' title={item.name}>{item.name}</div>
      {item.id !== '' && (
        <div className='shrink-0' onClick={e => e.stopPropagation()}>
          <Operation
            isActive={isSelected}
            isPinned={!!isPin}
            isItemHovering={isHovering}
            togglePin={() => onOperate(isPin ? 'unpin' : 'pin', item)}
            isShowDelete
            isShowRenameConversation
            onRenameConversation={() => onOperate('rename', item)}
            onDelete={() => onOperate('delete', item)}
          />
        </div>
      )}
    </div>
  )
}

export default memo(Item)
