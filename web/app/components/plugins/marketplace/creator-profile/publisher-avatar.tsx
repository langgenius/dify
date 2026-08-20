'use client'

import type { CSSProperties } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'

type PublisherAvatarProps = {
  avatarUrl: string
  name: string
  isOrganization: boolean
  size?: number
  className?: string
}

// Keep in sync with Creator Center `components/ui/avatar.tsx`.
const DEFAULT_AVATAR_BG = 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.08) 100%), linear-gradient(90deg, #155aef 0%, #155aef 100%)'

const DEFAULT_AVATAR_LETTER_STYLE: CSSProperties = {
  color: '#FFFFFF',
  textShadow: '0px 0.25px 0.5px rgba(0, 0, 0, 0.20)',
  lineHeight: '120%',
  textTransform: 'uppercase',
}

function getFallbackTextClass(size: number) {
  if (size <= 32)
    return 'text-xs'
  if (size <= 50)
    return 'text-base'
  return 'text-[40px]'
}

export default function PublisherAvatar({
  avatarUrl,
  name,
  isOrganization,
  size = 24,
  className,
}: PublisherAvatarProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const shapeClass = isOrganization ? 'rounded-md' : 'rounded-full'
  const shouldShowImage = Boolean(avatarUrl) && failedAvatarUrl !== avatarUrl
  const fallbackLetter = name?.[0]?.toUpperCase() || 'U'

  return (
    <div
      style={{ width: size, height: size }}
      className={cn(
        'relative shrink-0 overflow-hidden border-[0.5px] border-divider-regular',
        shapeClass,
        className,
      )}
    >
      {shouldShowImage ? (
        <img
          src={avatarUrl}
          alt={name}
          className={cn('size-full object-cover', shapeClass)}
          onError={() => setFailedAvatarUrl(avatarUrl)}
        />
      ) : (
        <div
          className={cn('flex size-full items-center justify-center', shapeClass)}
          style={{ background: DEFAULT_AVATAR_BG }}
        >
          <span
            className={cn(getFallbackTextClass(size), 'font-semibold')}
            style={DEFAULT_AVATAR_LETTER_STYLE}
          >
            {fallbackLetter}
          </span>
        </div>
      )}
    </div>
  )
}
