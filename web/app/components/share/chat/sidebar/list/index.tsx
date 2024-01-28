'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'

import { useBoolean, useInfiniteScroll } from 'ahooks'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import RenameModal from '../rename-modal'
import Item from './item'
import type { ConversationItem } from '@/models/share'
import { fetchConversations, renameConversation } from '@/service/share'
import Toast from '@/app/components/base/toast'

export type IListProps = {
  className: string
  currentId: string
  onCurrentIdChange: (id: string) => void
  list: ConversationItem[]
  onListChanged?: (newList: ConversationItem[]) => void
  isClearConversationList: boolean
  isInstalledApp: boolean
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
  onListChanged,
  isClearConversationList,
  isInstalledApp,
  installedAppId,
  onMoreLoaded,
  isNoMore,
  isPinned,
  onPinChanged,
  controlUpdate,
  onDelete,
}) => {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  useInfiniteScroll(
    async () => {
      if (!isNoMore) {
        let lastId = !isClearConversationList ? list[list.length - 1]?.id : undefined
        if (lastId === '-1')
          lastId = undefined
        const res = await fetchConversations(isInstalledApp, installedAppId, lastId, isPinned) as any
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
  const [isShowRename, { setTrue: setShowRename, setFalse: setHideRename }] = useBoolean(false)
  const [isSaving, { setTrue: setIsSaving, setFalse: setNotSaving }] = useBoolean(false)
  const [currentConversation, setCurrentConversation] = useState<ConversationItem | null>(null)
  const showRename = (item: ConversationItem) => {
    setCurrentConversation(item)
    setShowRename()
  }
  const handleRename = async (newName: string) => {
    if (!newName.trim() || !currentConversation) {
      Toast.notify({
        type: 'error',
        message: t('common.chat.conversationNameCanNotEmpty'),
      })
      return
    }

    setIsSaving()
    const currId = currentConversation.id
    try {
      await renameConversation(isInstalledApp, installedAppId, currId, newName)

      Toast.notify({
        type: 'success',
        message: t('common.actionMsg.modifiedSuccessfully'),
      })
      onListChanged?.(list.map((item) => {
        if (item.id === currId) {
          return {
            ...item,
            name: newName,
          }
        }
        return item
      }))
      setHideRename()
    }
    finally {
      setNotSaving()
    }
  }
  return (
    <nav
      ref={listRef}
      className={cn(className, 'shrink-0 space-y-1 bg-white overflow-y-auto overflow-x-hidden')}
    >
      {list.map((item) => {
        const isCurrent = item.id === currentId
        return (
          <Item
            key={item.id}
            item={item}
            isCurrent={isCurrent}
            onClick={onCurrentIdChange}
            isPinned={isPinned}
            togglePin={onPinChanged}
            onDelete={onDelete}
            onRenameConversation={showRename}
          />
        )
      })}
      {isShowRename && (
        <RenameModal
          isShow={isShowRename}
          onClose={setHideRename}
          saveLoading={isSaving}
          name={currentConversation?.name || ''}
          onSave={handleRename}
        />
      )}
    </nav>
  )
}

export default React.memo(List)
