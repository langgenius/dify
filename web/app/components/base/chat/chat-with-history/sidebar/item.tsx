import type { FC } from 'react'
import type { ConversationItem } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { useHover } from 'ahooks'
import { memo, useRef } from 'react'
import Operation from '@/app/components/base/chat/chat-with-history/sidebar/operation'

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
        'group flex rounded-lg p-1 pl-3 system-sm-medium text-components-menu-item-text hover:bg-state-base-hover',
        isSelected && 'bg-state-accent-active text-text-accent hover:bg-state-accent-active',
      )}
    >
      <button
        type="button"
        className="min-w-0 grow cursor-pointer appearance-none truncate border-0 bg-transparent p-1 pl-0 text-left"
        title={item.name}
        onClick={() => onChangeConversation(item.id)}
      >
        {item.name}
      </button>
      {item.id !== '' && (
        <div className="shrink-0">
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
