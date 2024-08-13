'use client'

import type { FC } from 'react'
import { init } from 'emoji-mart'
import data from '@emoji-mart/data'
import style from './style.module.css'
import classNames from '@/utils/classnames'
import type { AppIconType } from '@/types/app'

init({ data })

export type AppIconProps = {
  size?: 'xs' | 'tiny' | 'small' | 'medium' | 'large'
  rounded?: boolean
  iconType?: AppIconType
  icon?: string
  background?: string
  className?: string
  innerIcon?: React.ReactNode
  onClick?: () => void
}

const AppIcon: FC<AppIconProps> = ({
  size = 'medium',
  rounded = false,
  iconType = 'emoji',
  icon,
  background,
  className,
  innerIcon,
  onClick,
}) => {
  const wrapperClassName = classNames(
    style.appIcon,
    size !== 'medium' && style[size],
    rounded && style.rounded,
    className ?? '',
    'overflow-hidden',
  )

  return <span className={wrapperClassName} style={{ background }} onClick={onClick}>
    {iconType === 'emoji'
      ? (innerIcon || ((icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id='🤖' />))
      : <img src={icon} className="w-full h-full" alt="app icon" />
    }
  </span>
}

export default AppIcon
