'use client'
import type { FC } from 'react'
import React, { useRef } from 'react'
import {
  ChatBubbleOvalLeftEllipsisIcon,
} from '@heroicons/react/24/outline'
import { useInfiniteScroll } from 'ahooks'
import { ChatBubbleOvalLeftEllipsisIcon as ChatBubbleOvalLeftEllipsisSolidIcon } from '@heroicons/react/24/solid'
import cn from 'classnames'
import s from './style.module.css'
import type { ConversationItem } from '@/models/share'
import { fetchConversations } from '@/service/share'
import { fetchConversations as fetchUniversalConversations } from '@/service/universal-chat'
import ItemOperation from '@/app/components/explore/item-operation'

export type IListProps = {
  className: string
  currentId: string
  onCurrentIdChange: (id: string) => void
  list: ConversationItem[]
  isClearConversationList: boolean
  isInstalledApp: boolean
  isUniversalChat?: boolean
  installedAppId?: string
  onMoreLoaded: (res: { data: ConversationItem[]; has_more: boolean }) => void
  isNoMore: boolean
  isPinned: boolean
  onPinChanged: (id: string) => void
  controlUpdate: number
  onDelete: (id: string) => void
}

const List: FC<IListProps> = ({
  className,
  currentId,
  onCurrentIdChange,
  list,
  isClearConversationList,
  isInstalledApp,
  isUniversalChat,
  installedAppId,
  onMoreLoaded,
  isNoMore,
  isPinned,
  onPinChanged,
  controlUpdate,
  onDelete,
}) => {
  const listRef = useRef<HTMLDivElement>(null)

  useInfiniteScroll(
    async () => {
      if (!isNoMore) {
        let lastId = !isClearConversationList ? list[list.length - 1]?.id : undefined
        if (lastId === '-1')
          lastId = undefined
        let res: any
        if (isUniversalChat)
          res = await fetchUniversalConversations(lastId, isPinned)
        else
          res = await fetchConversations(isInstalledApp, installedAppId, lastId, isPinned)
        const { data: conversations, has_more }: any = res
        onMoreLoaded({ data: conversations, has_more })
      }
      return { list: [] }
    },
    {
      target: listRef,
      isNoMore: () => {
        return isNoMore
      },
      reloadDeps: [isNoMore, controlUpdate],
    },
  )
  return (
    <nav
      ref={listRef}
      className={cn(className, 'shrink-0 space-y-1 bg-white overflow-y-auto overflow-x-hidden')}
    >
      {list.map((item) => {
        const isCurrent = item.id === currentId
        const ItemIcon
            = isCurrent ? ChatBubbleOvalLeftEllipsisSolidIcon : ChatBubbleOvalLeftEllipsisIcon
        return (
          <div
            onClick={() => onCurrentIdChange(item.id)}
            key={item.id}
            className={cn(s.item,
              isCurrent
                ? 'bg-primary-50 text-primary-600'
                : 'text-gray-700 hover:bg-gray-200 hover:text-gray-700',
              'group flex justify-between items-center rounded-md px-2 py-2 text-sm font-medium cursor-pointer',
            )}
          >
            <div className='flex items-center w-0 grow'>
              <ItemIcon
                className={cn(
                  isCurrent
                    ? 'text-primary-600'
                    : 'text-gray-400 group-hover:text-gray-500',
                  'mr-3 h-5 w-5 flex-shrink-0',
                )}
                aria-hidden="true"
              />
              <span>{item.name}</span>
            </div>

            {item.id !== '-1' && (
              <div className={cn(s.opBtn, 'shrink-0')} onClick={e => e.stopPropagation()}>
                <ItemOperation
                  isPinned={isPinned}
                  togglePin={() => onPinChanged(item.id)}
                  isShowDelete
                  onDelete={() => onDelete(item.id)}
                />
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

export default React.memo(List)
