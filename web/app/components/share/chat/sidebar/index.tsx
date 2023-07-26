import React, { useEffect, useState } from 'react'
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
import { fetchConversations as fetchUniversalConversations } from '@/service/universal-chat'

export type ISidebarProps = {
  copyRight: string
  currentId: string
  onCurrentIdChange: (id: string) => void
  list: ConversationItem[]
  isClearConversationList: boolean
  pinnedList: ConversationItem[]
  isClearPinnedConversationList: boolean
  isInstalledApp: boolean
  installedAppId?: string
  isUniversalChat?: boolean
  siteInfo: SiteInfo
  onMoreLoaded: (res: { data: ConversationItem[]; has_more: boolean }) => void
  onPinnedMoreLoaded: (res: { data: ConversationItem[]; has_more: boolean }) => void
  isNoMore: boolean
  isPinnedNoMore: boolean
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  controlUpdateList: number
  onDelete: (id: string) => void
}

const Sidebar: FC<ISidebarProps> = ({
  copyRight,
  currentId,
  onCurrentIdChange,
  list,
  isClearConversationList,
  pinnedList,
  isClearPinnedConversationList,
  isInstalledApp,
  installedAppId,
  isUniversalChat,
  siteInfo,
  onMoreLoaded,
  onPinnedMoreLoaded,
  isNoMore,
  isPinnedNoMore,
  onPin,
  onUnpin,
  controlUpdateList,
  onDelete,
}) => {
  const { t } = useTranslation()
  const [hasPinned, setHasPinned] = useState(false)

  const checkHasPinned = async () => {
    let res: any
    if (isUniversalChat)
      res = await fetchUniversalConversations(undefined, true)

    else
      res = await fetchConversations(isInstalledApp, installedAppId, undefined, true)

    setHasPinned(res.data.length > 0)
  }

  useEffect(() => {
    checkHasPinned()
  }, [])

  useEffect(() => {
    if (controlUpdateList !== 0)
      checkHasPinned()
  }, [controlUpdateList])

  const maxListHeight = (isInstalledApp || isUniversalChat) ? 'max-h-[30vh]' : 'max-h-[40vh]'

  return (
    <div
      className={
        cn(
          (isInstalledApp || isUniversalChat) ? 'tablet:h-[calc(100vh_-_74px)]' : 'tablet:h-[calc(100vh_-_3rem)]',
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
          onClick={() => { onCurrentIdChange('-1') }}
          className="group block w-full flex-shrink-0 !justify-start !h-9 text-primary-600 items-center text-sm">
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
              isClearConversationList={isClearPinnedConversationList}
              isInstalledApp={isInstalledApp}
              installedAppId={installedAppId}
              isUniversalChat={isUniversalChat}
              onMoreLoaded={onPinnedMoreLoaded}
              isNoMore={isPinnedNoMore}
              isPinned={true}
              onPinChanged={id => onUnpin(id)}
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
            isClearConversationList={isClearConversationList}
            isInstalledApp={isInstalledApp}
            installedAppId={installedAppId}
            isUniversalChat={isUniversalChat}
            onMoreLoaded={onMoreLoaded}
            isNoMore={isNoMore}
            isPinned={false}
            onPinChanged={id => onPin(id)}
            controlUpdate={controlUpdateList + 1}
            onDelete={onDelete}
          />
        </div>

      </div>
      {!isUniversalChat && (
        <div className="flex flex-shrink-0 pr-4 pb-4 pl-4">
          <div className="text-gray-400 font-normal text-xs">© {copyRight} {(new Date()).getFullYear()}</div>
        </div>
      )}
    </div>
  )
}

export default React.memo(Sidebar)
