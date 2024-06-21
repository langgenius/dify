import React, { useCallback, useEffect, useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import cn from 'classnames'
import Button from '../../../base/button'
import List from './list'
import AppInfo from '@/app/components/share/chat/sidebar/app-info'
// import Card from './card'
import type { ConversationItem, SiteInfo } from '@/models/share'
import { fetchConversations } from '@/service/share'

export type ISidebarProps = {
  copyRight: string
  currentId: string
  onCurrentIdChange: (id: string) => void
  list: ConversationItem[]
  onListChanged: (newList: ConversationItem[]) => void
  isClearConversationList: boolean
  pinnedList: ConversationItem[]
  onPinnedListChanged: (newList: ConversationItem[]) => void
  isClearPinnedConversationList: boolean
  isInstalledApp: boolean
  installedAppId?: string
  siteInfo: SiteInfo
  onMoreLoaded: (res: { data: ConversationItem[]; has_more: boolean }) => void
  onPinnedMoreLoaded: (res: { data: ConversationItem[]; has_more: boolean }) => void
  isNoMore: boolean
  isPinnedNoMore: boolean
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  controlUpdateList: number
  onDelete: (id: string) => void
  onStartChat: (inputs: Record<string, any>) => void
}

const Sidebar: FC<ISidebarProps> = ({
  copyRight,
  currentId,
  onCurrentIdChange,
  list,
  onListChanged,
  isClearConversationList,
  pinnedList,
  onPinnedListChanged,
  isClearPinnedConversationList,
  isInstalledApp,
  installedAppId,
  siteInfo,
  onMoreLoaded,
  onPinnedMoreLoaded,
  isNoMore,
  isPinnedNoMore,
  onPin,
  onUnpin,
  controlUpdateList,
  onDelete,
  onStartChat,
}) => {
  const { t } = useTranslation()
  const [hasPinned, setHasPinned] = useState(false)

  const checkHasPinned = async () => {
    const res = await fetchConversations(isInstalledApp, installedAppId, undefined, true) as any
    setHasPinned(res.data.length > 0)
  }

  useEffect(() => {
    checkHasPinned()
  }, [])

  useEffect(() => {
    if (controlUpdateList !== 0)
      checkHasPinned()
  }, [controlUpdateList])

  const handleUnpin = useCallback((id: string) => {
    onUnpin(id)
  }, [onUnpin])
  const handlePin = useCallback((id: string) => {
    onPin(id)
  }, [onPin])

  const maxListHeight = (isInstalledApp) ? 'max-h-[30vh]' : 'max-h-[40vh]'

  return (
    <div
      className={
        cn(
          (isInstalledApp) ? 'tablet:h-[calc(100vh_-_74px)]' : '',
          'shrink-0 flex flex-col bg-white pc:w-[244px] tablet:w-[192px] mobile:w-[240px]  border-r border-gray-200 mobile:h-screen',
        )
      }
    >
      {isInstalledApp && (
        <AppInfo
          className='my-4 px-4'
          name={siteInfo.title || ''}
          icon={siteInfo.icon || ''}
          icon_background={siteInfo.icon_background}
        />
      )}
      <div className="flex flex-shrink-0 p-4 !pb-0">
        <Button
          onClick={() => onStartChat({})}
          variant='secondary-accent'
          className="group w-full flex-shrink-0 justify-start">
          <PencilSquareIcon className="mr-2 h-4 w-4" /> {t('share.chat.newChat')}
        </Button>
      </div>
      <div className={'flex-grow flex flex-col h-0 overflow-y-auto overflow-x-hidden'}>
        {/* pinned list */}
        {hasPinned && (
          <div className={cn('mt-4 px-4', list.length === 0 && 'flex flex-col flex-grow')}>
            <div className='mb-1.5 leading-[18px] text-xs text-gray-500 font-medium uppercase'>{t('share.chat.pinnedTitle')}</div>
            <List
              className={cn(list.length > 0 ? maxListHeight : 'flex-grow')}
              currentId={currentId}
              onCurrentIdChange={onCurrentIdChange}
              list={pinnedList}
              onListChanged={onPinnedListChanged}
              isClearConversationList={isClearPinnedConversationList}
              isInstalledApp={isInstalledApp}
              installedAppId={installedAppId}
              onMoreLoaded={onPinnedMoreLoaded}
              isNoMore={isPinnedNoMore}
              isPinned={true}
              onPinChanged={handleUnpin}
              controlUpdate={controlUpdateList + 1}
              onDelete={onDelete}
            />
          </div>
        )}
        {/* unpinned list */}
        <div className={cn('grow flex flex-col mt-4 px-4', !hasPinned && 'flex flex-col flex-grow')}>
          {(hasPinned && list.length > 0) && (
            <div className='mb-1.5 leading-[18px] text-xs text-gray-500 font-medium uppercase'>{t('share.chat.unpinnedTitle')}</div>
          )}
          <List
            className={cn('flex-grow h-0')}
            currentId={currentId}
            onCurrentIdChange={onCurrentIdChange}
            list={list}
            onListChanged={onListChanged}
            isClearConversationList={isClearConversationList}
            isInstalledApp={isInstalledApp}
            installedAppId={installedAppId}
            onMoreLoaded={onMoreLoaded}
            isNoMore={isNoMore}
            isPinned={false}
            onPinChanged={handlePin}
            controlUpdate={controlUpdateList + 1}
            onDelete={onDelete}
          />
        </div>

      </div>
      <div className="flex flex-shrink-0 pr-4 pb-4 pl-4">
        <div className="text-gray-400 font-normal text-xs">© {copyRight} {(new Date()).getFullYear()}</div>
      </div>
    </div>
  )
}

export default React.memo(Sidebar)
