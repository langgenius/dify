'use client'

import type { CSSProperties } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { getAvatarInitial } from '@/utils/avatar'

type PublisherAvatarProps = {
  avatarUrl: string
  name: string
  isOrganization: boolean
  size?: number
  className?: string
}

// Keep in sync with Creator Center `components/ui/avatar.tsx`.
const DEFAULT_AVATAR_BG =
  'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.08) 100%), linear-gradient(90deg, #155aef 0%, #155aef 100%)'

const DEFAULT_AVATAR_LETTER_STYLE: CSSProperties = {
  color: '#FFFFFF',
  textShadow: '0px 0.25px 0.5px rgba(0, 0, 0, 0.20)',
  lineHeight: '120%',
  textTransform: 'uppercase',
}

function getFallbackTextClass(size: number) {
  if (size <= 32) return 'text-xs'
  if (size <= 50) return 'text-base'
  return 'text-[40px]'
}

export default function PublisherAvatar({
  avatarUrl,
  name,
  isOrganization,
  size = 24,
  className,
}: PublisherAvatarProps) {
  const shapeClass = isOrganization ? 'rounded-md' : 'rounded-full'
  const fallbackLetter = getAvatarInitial(name)

  return (
    <Avatar
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('border-[0.5px] border-divider-regular', shapeClass, className)}
    >
      <AvatarFallback style={{ background: DEFAULT_AVATAR_BG }}>
        <span
          className={cn(getFallbackTextClass(size), 'font-semibold')}
          style={DEFAULT_AVATAR_LETTER_STYLE}
        >
          {fallbackLetter}
        </span>
      </AvatarFallback>
      <AvatarImage keepMounted src={avatarUrl || undefined} alt="" />
    </Avatar>
  )
}
