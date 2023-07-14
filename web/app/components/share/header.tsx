import type { FC } from 'react'
import React from 'react'
import AppIcon from '@/app/components/base/app-icon'
export type IHeaderProps = {
  title: string
  icon: string
  icon_background: string
  isMobile?: boolean
  isEmbedScene?: boolean
}
const Header: FC<IHeaderProps> = ({
  title,
  isMobile,
  icon,
  icon_background,
  isEmbedScene = false,
}) => {
  return !isMobile
    ? null
    : (
      <div
        className={`shrink-0 flex items-center justify-between h-12 px-3 bg-gray-100 ${
          isEmbedScene ? 'bg-gradient-to-r from-blue-600 to-sky-500' : ''
        }`}
      >
        <div></div>
        <div className="flex items-center space-x-2">
          <AppIcon size="small" icon={icon} background={icon_background} />
          <div
            className={`text-sm text-gray-800 font-bold ${
              isEmbedScene ? 'text-white' : ''
            }`}
          >
            {title}
          </div>
        </div>
        <div></div>
      </div>
    )
}

export default React.memo(Header)
