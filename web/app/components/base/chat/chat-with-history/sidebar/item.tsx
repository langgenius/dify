import type { FC } from 'react'
import {
  memo,
  useRef,
} from 'react'
import { useHover } from 'ahooks'
import type { ConversationItem } from '@/models/share'
import { MessageDotsCircle } from '@/app/components/base/icons/src/vender/solid/communication'
import ItemOperation from '@/app/components/explore/item-operation'

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

  return (
    <div
      ref={ref}
      key={item.id}
      className={`
        flex mb-0.5 last-of-type:mb-0 py-1.5 pl-3 pr-1.5 text-sm font-medium text-gray-700 
        rounded-lg cursor-pointer hover:bg-gray-50 group
        ${currentConversationId === item.id && 'text-primary-600 bg-primary-50'}
      `}
      onClick={() => onChangeConversation(item.id)}
    >
      <MessageDotsCircle className={`shrink-0 mt-1 mr-2 w-4 h-4 text-gray-400 ${currentConversationId === item.id && 'text-primary-600'}`} />
      <div className='grow py-0.5 break-all' title={item.name}>{item.name}</div>
      {item.id !== '' && (
        <div className='shrink-0 h-6' onClick={e => e.stopPropagation()}>
          <ItemOperation
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
