'use client'

import type { RecommendedAppInfoResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ReactNode } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import { resolveEmoji } from '@/utils/emoji'

type AppIconData = Pick<RecommendedAppInfoResponse, 'icon' | 'icon_type' | 'icon_background'> &
  Partial<Pick<RecommendedAppInfoResponse, 'icon_url'>>

export type AppIconProps = {
  icon?: AppIconData | null
  fallback?: { content: ReactNode; background?: string | null }
  size?: 'xs' | 'tiny' | 'small' | 'medium' | 'large' | 'xl' | 'xxl'
  shape?: 'square' | 'circle'
  className?: string
} & ({ decorative?: true; label?: never } | { decorative: false; label: string })

const appIconVariants = cva(
  'flex shrink-0 grow-0 border-[0.5px] border-divider-regular leading-none',
  {
    variants: {
      size: {
        xs: 'size-4 rounded-sm text-xs',
        tiny: 'size-6 rounded-md text-base',
        small: 'size-8 rounded-lg text-xl',
        medium: 'size-9 rounded-[10px] text-[22px]',
        large: 'size-10 rounded-[10px] text-2xl',
        xl: 'size-12 rounded-xl text-[28px]',
        xxl: 'size-14 rounded-2xl text-[32px]',
      },
      shape: {
        square: '',
        circle: 'rounded-full',
      },
    },
  },
)

export default function AppIcon({
  icon,
  fallback,
  size = 'medium',
  shape = 'square',
  decorative = true,
  label,
  className,
}: AppIconProps) {
  const isImage = icon?.icon_type === 'image' || icon?.icon_type === 'link'
  const src = icon?.icon_type === 'link' ? icon.icon : icon?.icon_url
  const emoji = !icon?.icon_type || icon.icon_type === 'emoji' ? icon?.icon : undefined
  const background = (!isImage && icon?.icon_background) || fallback?.background || '#FFEAD5'

  return (
    <Avatar
      className={cn(appIconVariants({ size, shape }), className)}
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
    >
      <AvatarFallback className="bg-transparent font-normal text-inherit" style={{ background }}>
        {emoji ? resolveEmoji(emoji) : (fallback?.content ?? '🤖')}
      </AvatarFallback>
      {isImage && <AvatarImage src={src || undefined} alt="" className="object-fill" />}
    </Avatar>
  )
}
