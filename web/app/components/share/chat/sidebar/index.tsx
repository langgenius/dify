import React, { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChatBubbleOvalLeftEllipsisIcon,
  PencilSquareIcon
} from '@heroicons/react/24/outline'
import { ChatBubbleOvalLeftEllipsisIcon as ChatBubbleOvalLeftEllipsisSolidIcon, } from '@heroicons/react/24/solid'
import Button from '../../../base/button'
import AppInfo from '@/app/components/share/chat/sidebar/app-info'
// import Card from './card'
import type { ConversationItem, SiteInfo } from '@/models/share'
import { useInfiniteScroll } from 'ahooks'
import { fetchConversations } from '@/service/share'

function classNames(...classes: any[]) {
  return classes.filter(Boolean).join(' ')
}

export type ISidebarProps = {
  copyRight: string
  currentId: string
  onCurrentIdChange: (id: string) => void
  list: ConversationItem[]
  isInstalledApp: boolean
  installedAppId?: string
  siteInfo: SiteInfo
  onMoreLoaded: (res: {data: ConversationItem[], has_more: boolean}) => void
  isNoMore: boolean
}

const Sidebar: FC<ISidebarProps> = ({
  copyRight,
  currentId,
  onCurrentIdChange,
  list,
  isInstalledApp,
  installedAppId,
  siteInfo,
  onMoreLoaded,
  isNoMore,
}) => {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)

  useInfiniteScroll(
    async () => {
      if(!isNoMore) {
        const lastId = list[list.length - 1].id
        const { data: conversations, has_more }: any = await fetchConversations(isInstalledApp, installedAppId, lastId)
        onMoreLoaded({ data: conversations, has_more })
      }
      return {list: []}
    },
    {
      target: listRef,
      isNoMore: () => {
        return isNoMore
      },
      reloadDeps: [isNoMore]
    },
  )

  return (
    <div
      className={
        classNames(
          isInstalledApp ? 'tablet:h-[calc(100vh_-_74px)]' : 'tablet:h-[calc(100vh_-_3rem)]',
          "shrink-0 flex flex-col bg-white pc:w-[244px] tablet:w-[192px] mobile:w-[240px]  border-r border-gray-200 mobile:h-screen"
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

      <nav
        ref={listRef}
        className="mt-4 flex-1 space-y-1 bg-white p-4 !pt-0 overflow-y-auto"
      >
        {list.map((item) => {
          const isCurrent = item.id === currentId
          const ItemIcon
            = isCurrent ? ChatBubbleOvalLeftEllipsisSolidIcon : ChatBubbleOvalLeftEllipsisIcon
          return (
            <div
              onClick={() => onCurrentIdChange(item.id)}
              key={item.id}
              className={classNames(
                isCurrent
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-gray-700 hover:bg-gray-100 hover:text-gray-700',
                'group flex items-center rounded-md px-2 py-2 text-sm font-medium cursor-pointer',
              )}
            >
              <ItemIcon
                className={classNames(
                  isCurrent
                    ? 'text-primary-600'
                    : 'text-gray-400 group-hover:text-gray-500',
                  'mr-3 h-5 w-5 flex-shrink-0',
                )}
                aria-hidden="true"
              />
              {item.name}
            </div>
          )
        })}
      </nav>
      <div className="flex flex-shrink-0 pr-4 pb-4 pl-4">
        <div className="text-gray-400 font-normal text-xs">© {copyRight} {(new Date()).getFullYear()}</div>
      </div>
    </div>
  )
}

export default React.memo(Sidebar)
