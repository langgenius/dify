import type { FC } from 'react'
import React from 'react'
import {
  Bars3Icon,
  PencilSquareIcon,
} from '@heroicons/react/24/solid'
import AppIcon from '@/app/components/base/app-icon'
export type IHeaderProps = {
  title: string
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
  icon,
  icon_background,
  isEmbedScene = false,
  onShowSideBar,
  onCreateNewChat,
}) => {
  return (
    <div className={`shrink-0 flex items-center justify-between h-12 px-3 bg-gray-100 ${isEmbedScene ? 'bg-gradient-to-r from-blue-600 to-sky-500' : ''}`}>
      {isMobile
        ? (
          <div
            className='flex items-center justify-center h-8 w-8 cursor-pointer'
            onClick={() => onShowSideBar?.()}
          >
            <Bars3Icon className="h-4 w-4 text-gray-500" />
          </div>
        )
        : <div></div>}
      <div className='flex items-center space-x-2'>
        <AppIcon size="small" icon={icon} background={icon_background} />
        <div className={`text-sm text-gray-800 font-bold ${isEmbedScene ? 'text-white' : ''}` }>{title}</div>
      </div>
      {isMobile
        ? (
          <div className='flex items-center justify-center h-8 w-8 cursor-pointer'
            onClick={() => onCreateNewChat?.()}
          >
            <PencilSquareIcon className="h-4 w-4 text-gray-500" />
          </div>)
        : <div></div>}
    </div>
  )
}

export default React.memo(Header)
