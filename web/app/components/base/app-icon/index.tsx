'use client'
import type { FC } from 'react'
import type { AppIconType } from '@/types/app'
import data from '@emoji-mart/data'
import { RiEditLine } from '@remixicon/react'
import { useHover } from 'ahooks'
import { cva } from 'class-variance-authority'
import { init } from 'emoji-mart'
import * as React from 'react'
import { useRef } from 'react'
import { cn } from '@/utils/classnames'

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
  'relative flex shrink-0 grow-0 items-center justify-center overflow-hidden border-[0.5px] border-divider-regular leading-none',
  {
    variants: {
      size: {
        xs: 'h-4 w-4 rounded-[4px] text-xs',
        tiny: 'h-6 w-6 rounded-md text-base',
        small: 'h-8 w-8 rounded-lg text-xl',
        medium: 'h-9 w-9 rounded-[10px] text-[22px]',
        large: 'h-10 w-10 rounded-[10px] text-[24px]',
        xl: 'h-12 w-12 rounded-xl text-[28px]',
        xxl: 'h-14 w-14 rounded-2xl text-[32px]',
      },
      rounded: {
        true: 'rounded-full',
      },
    },
    defaultVariants: {
      size: 'medium',
      rounded: false,
    },
  },
)
const EditIconWrapperVariants = cva(
  'absolute left-0 top-0 z-10 flex items-center justify-center bg-background-overlay-alt',
  {
    variants: {
      size: {
        xs: 'h-4 w-4 rounded-[4px]',
        tiny: 'h-6 w-6 rounded-md',
        small: 'h-8 w-8 rounded-lg',
        medium: 'h-9 w-9 rounded-[10px]',
        large: 'h-10 w-10 rounded-[10px]',
        xl: 'h-12 w-12 rounded-xl',
        xxl: 'h-14 w-14 rounded-2xl',
      },
      rounded: {
        true: 'rounded-full',
      },
    },
    defaultVariants: {
      size: 'medium',
      rounded: false,
    },
  },
)
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
  },
)
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
  const Icon = (icon && icon !== '') ? <em-emoji id={icon} /> : <em-emoji id="🤖" />
  const wrapperRef = useRef<HTMLSpanElement>(null)
  const isHovering = useHover(wrapperRef)

  return (
    <span
      ref={wrapperRef}
      className={cn(appIconVariants({ size, rounded }), className)}
      style={{ background: isValidImageIcon ? undefined : (background || '#FFEAD5') }}
      onClick={onClick}
    >
      {
        isValidImageIcon
          ? <img src={imageUrl} className="h-full w-full" alt="app icon" />
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
