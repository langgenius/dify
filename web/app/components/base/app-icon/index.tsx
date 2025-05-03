'use client'
import React, { type FC, useRef } from 'react'
import { init } from 'emoji-mart'
import data from '@emoji-mart/data'
import { cva } from 'class-variance-authority'
import type { AppIconType } from '@/types/app'
import classNames from '@/utils/classnames'
import { useHover } from 'ahooks'
import { RiEditLine } from '@remixicon/react'

init({ data })

export type AppIconProps = {
  size?: 'xs' | 'tiny' | 'small' | 'medium' | 'large' | 'xl' | 'xxl'
  rounded?: boolean
  iconType?: AppIconType | null
  icon?: string
  background?: string | null
  imageUrl?: string | null
  className?: string
  innerIcon?: React.ReactNode
  onClick?: () => void
}
const appIconVariants = cva(
  'flex items-center justify-center relative text-lg rounded-2xl grow-0 shrink-0 overflow-hidden leading-none border-[0.5px] border-divider-regular',
  {
    variants: {
      size: {
        xs: 'w-4 h-4 text-xs',
        tiny: 'w-6 h-6 text-base',
        small: 'w-8 h-8 text-xl',
        medium: 'w-9 h-9 text-[22px]',
        large: 'w-10 h-10 text-[24px]',
        xl: 'w-12 h-12 text-[28px]',
        xxl: 'w-14 h-14 text-[32px]',
      },
      rounded: {
        true: 'rounded-full',
      },
    },
    defaultVariants: {
      size: 'medium',
      rounded: false,
    },
  })
const AppIcon: FC<AppIconProps> = ({
  size = 'medium',
  rounded = false,
  iconType,
  icon,
  background,
  imageUrl,
  className,
  innerIcon,
  onClick,
}) => {
  const isValidImageIcon = iconType === 'image' && imageUrl
  const Icon = (icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id='🤖' />
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const isHovering = useHover(wrapperRef)

  return (
    <span
      ref={wrapperRef}
      className={classNames(appIconVariants({ size, rounded }), className)}
      style={{ background: isValidImageIcon ? undefined : (background || '#FFEAD5') }}
      onClick={onClick}
    >
      {
        isValidImageIcon
          ? <img src={imageUrl} className='h-full w-full' alt='app icon' />
          : (innerIcon || Icon)
      }
      {
        isHovering && (
          <div className='absolute left-0 top-0 z-10 flex size-14 items-center justify-center rounded-2xl bg-background-overlay-alt'>
            <RiEditLine className='size-6 text-text-primary-on-surface' />
          </div>
        )
      }
    </span>
  )
}

export default React.memo(AppIcon)
