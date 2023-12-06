import type { FC } from 'react'
import React from 'react'
import {
  Bars3Icon,
  PencilSquareIcon,
} from '@heroicons/react/24/solid'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { ReplayIcon } from '@/app/components/app/chat/icon-component'
import Tooltip from '@/app/components/base/tooltip'

export type IHeaderProps = {
  title: string
  customerIcon?: React.ReactNode
  icon: string
  icon_background: string
  isMobile?: boolean
  isEmbedScene?: boolean
  onShowSideBar?: () => void
  onCreateNewChat?: () => void
}
const Header: FC<IHeaderProps> = ({
  title,
  isMobile,
  customerIcon,
  icon,
  icon_background,
  isEmbedScene = false,
  onShowSideBar,
  onCreateNewChat,
}) => {
  const { t } = useTranslation()
  if (!isMobile)
    return null

  if (isEmbedScene) {
    return (
      <div
        className={`
          shrink-0 flex items-center justify-between h-14 px-4 bg-gray-100 
          bg-gradient-to-r from-blue-600 to-sky-500
        `}
      >
        <div className="flex items-center space-x-2">
          {customerIcon || <AppIcon size="small" icon={icon} background={icon_background} />}
          <div
            className={'text-sm font-bold text-white'}
          >
            {title}
          </div>
        </div>
        <Tooltip
          selector={'embed-scene-restart-button'}
          htmlContent={t('share.chat.resetChat')}
          position='top'
        >
          <div className='flex cursor-pointer hover:rounded-lg hover:bg-black/5 w-8 h-8 items-center justify-center' onClick={() => {
            onCreateNewChat?.()
          }}>
            <ReplayIcon className="h-4 w-4 text-sm font-bold text-white" />
          </div>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="shrink-0 flex items-center justify-between h-14 px-4 bg-gray-100">
      <div
        className='flex items-center justify-center h-8 w-8 cursor-pointer'
        onClick={() => onShowSideBar?.()}
      >
        <Bars3Icon className="h-4 w-4 text-gray-500" />
      </div>
      <div className='flex items-center space-x-2'>
        <AppIcon size="small" icon={icon} background={icon_background} />
        <div className=" text-sm text-gray-800 font-bold">{title}</div>
      </div>
      <div className='flex items-center justify-center h-8 w-8 cursor-pointer'
        onClick={() => onCreateNewChat?.()}
      >
        <PencilSquareIcon className="h-4 w-4 text-gray-500" />
      </div>
    </div>
  )
}

export default React.memo(Header)
