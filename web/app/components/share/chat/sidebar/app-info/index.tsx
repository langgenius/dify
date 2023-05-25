'use client'
import React, { FC } from 'react'
import cn  from 'classnames'
import { appDefaultIconBackground } from '@/config/index'
import AppIcon from '@/app/components/base/app-icon'

export interface IAppInfoProps {
  className?: string
  icon: string
  icon_background?: string
  name: string
}

const AppInfo: FC<IAppInfoProps> = ({
  className,
  icon,
  icon_background,
  name
}) => {
  return (
    <div className={cn(className, 'flex items-center space-x-3')}>
      <AppIcon size="small" icon={icon} background={icon_background || appDefaultIconBackground} />
      <div className='w-0 grow text-sm font-semibold text-gray-800 overflow-hidden  text-ellipsis whitespace-nowrap'>{name}</div>
    </div>
  )
}
export default React.memo(AppInfo)
