'use client'
import type { FC } from 'react'
import type { AppIconType } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { resolveEmoji } from '@/utils/emoji'

type AppIconProps = {
  size?: 'xs' | 'tiny' | 'small' | 'medium' | 'large' | 'xl' | 'xxl'
  rounded?: boolean
  iconType?: AppIconType | null
  icon?: string
  background?: string | null
  imageUrl?: string | null
  decorative?: boolean
  className?: string
  innerIcon?: React.ReactNode
  showEditIcon?: boolean
}
const appIconVariants = cva(
  'relative flex shrink-0 grow-0 items-center justify-center overflow-hidden border-[0.5px] border-divider-regular leading-none',
  {
    variants: {
      size: {
        xs: 'size-4 rounded-sm text-xs',
        tiny: 'size-6 rounded-md text-base',
        small: 'size-8 rounded-lg text-xl',
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
const EditIconVariants = cva('i-ri-edit-line text-text-primary-on-surface', {
  variants: {
    size: {
      xs: 'size-3',
      tiny: 'size-3.5',
      small: 'size-5',
      medium: 'size-5.5',
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
  decorative = false,
  className,
  innerIcon,
  showEditIcon = false,
}) => {
  const isValidImageIcon = iconType === 'image' && imageUrl
  const Icon = resolveEmoji(icon)

  return (
    <span
      className={cn('group/app-icon', appIconVariants({ size, rounded }), className)}
      style={{ background: isValidImageIcon ? undefined : background || '#FFEAD5' }}
      aria-hidden={decorative || undefined}
    >
      {isValidImageIcon ? (
        <img src={imageUrl} className="size-full" alt={decorative ? '' : 'app icon'} />
      ) : (
        innerIcon || Icon
      )}
      {showEditIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center bg-background-overlay-alt group-hover/app-icon:flex group-focus-visible/edit-icon:flex"
        >
          <span className={EditIconVariants({ size })} />
        </span>
      )}
    </span>
  )
}

export default React.memo(AppIcon)
