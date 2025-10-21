'use client'
import React from 'react'
import { type FC, useRef } from 'react'
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
  coverElement?: React.ReactNode
  showEditIcon?: boolean
  onClick?: () => void
}
const appIconVariants = cva(
  'flex items-center justify-center relative grow-0 shrink-0 overflow-hidden leading-none border-[0.5px] border-divider-regular',
  {
    variants: {
      size: {
        xs: 'w-4 h-4 text-xs rounded-[4px]',
        tiny: 'w-6 h-6 text-base rounded-md',
        small: 'w-8 h-8 text-xl rounded-lg',
        medium: 'w-9 h-9 text-[22px] rounded-[10px]',
        large: 'w-10 h-10 text-[24px] rounded-[10px]',
        xl: 'w-12 h-12 text-[28px] rounded-xl',
        xxl: 'w-14 h-14 text-[32px] rounded-2xl',
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
const EditIconWrapperVariants = cva(
  'absolute left-0 top-0 z-10 flex items-center justify-center bg-background-overlay-alt',
  {
    variants: {
      size: {
        xs: 'w-4 h-4 rounded-[4px]',
        tiny: 'w-6 h-6 rounded-md',
        small: 'w-8 h-8 rounded-lg',
        medium: 'w-9 h-9 rounded-[10px]',
        large: 'w-10 h-10 rounded-[10px]',
        xl: 'w-12 h-12 rounded-xl',
        xxl: 'w-14 h-14 rounded-2xl',
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
const EditIconVariants = cva(
  'text-text-primary-on-surface',
  {
    variants: {
      size: {
        xs: 'size-3',
        tiny: 'size-3.5',
        small: 'size-5',
        medium: 'size-[22px]',
        large: 'size-6',
        xl: 'size-7',
        xxl: 'size-8',
      },
    },
    defaultVariants: {
      size: 'medium',
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
  coverElement,
  onClick,
  showEditIcon = false,
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
        showEditIcon && isHovering && (
          <div className={EditIconWrapperVariants({ size, rounded })}>
            <RiEditLine className={EditIconVariants({ size })} />
          </div>
        )
      }
      {coverElement}
    </span>
  )
}

export default React.memo(AppIcon)
