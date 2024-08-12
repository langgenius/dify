'use client'

import { useState } from 'react'
import type { FC, PropsWithChildren } from 'react'
import { useAsyncEffect } from 'ahooks'
import Image from 'next/image'
import { init } from 'emoji-mart'
import data from '@emoji-mart/data'
import style from './style.module.css'
import classNames from '@/utils/classnames'
import type { AppIconType } from '@/types/app'
import { fetchAppIconPreviewUrl } from '@/service/apps'

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

const AppIconWrapper = ({
  size = 'medium',
  rounded = false,
  background,
  className,
  onClick,
  children,
}: PropsWithChildren<Pick<AppIconProps, 'size' | 'rounded' | 'background' | 'className' | 'onClick'>>) => {
  const wrapperClassName = classNames(
    style.appIcon,
    size !== 'medium' && style[size],
    rounded && style.rounded,
    className ?? '',
  )
  return <span className={wrapperClassName} style={{ background }} onClick={onClick}>{children}</span>
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
  const [imageIconSrc, setImageIconSrc] = useState('')
  const [loading, setLoading] = useState(true)

  useAsyncEffect(async () => {
    if (iconType === 'image' && icon) {
      setLoading(true)
      const res = await fetchAppIconPreviewUrl({ fileID: icon })
      setImageIconSrc(res)
      setLoading(false)
    }
  }, [iconType, icon])

  return <AppIconWrapper size={size} rounded={rounded} background={background} className={className} onClick={onClick}>
    {iconType === 'emoji'
      ? (innerIcon || ((icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id='🤖' />))
      : loading
        ? ''
        : <Image src={imageIconSrc} className="w-full h-full" alt="App icon" />
    }
  </AppIconWrapper>
}

export default AppIcon
