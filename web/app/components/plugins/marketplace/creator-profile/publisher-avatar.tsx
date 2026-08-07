'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'

type PublisherAvatarProps = {
  avatarUrl: string
  name: string
  isOrganization: boolean
  size?: number
  className?: string
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
          className={cn(
            'flex size-full items-center justify-center bg-background-default-subtle',
            shapeClass,
          )}
        >
          <span className="system-xs-medium text-text-tertiary">
            {name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
    </div>
  )
}
