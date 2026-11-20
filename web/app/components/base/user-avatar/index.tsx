'use client'

import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { getAvatarInitial } from '@/utils/avatar'

type UserAvatarProps = Omit<AvatarProps, 'children'> & {
  name: string
  src?: string | null
  fallbackColor?: string
}

export function UserAvatar({ name, src, fallbackColor, ...avatarProps }: UserAvatarProps) {
  return (
    <Avatar {...avatarProps}>
      <AvatarFallback
        render={(props, { imageLoadingStatus }) => {
          const showInitial = !src || imageLoadingStatus === 'error'
          return (
            <span
              {...props}
              className={cn(props.className, !showInitial && 'bg-background-section-burn')}
              style={
                showInitial && fallbackColor
                  ? { ...props.style, backgroundColor: fallbackColor }
                  : props.style
              }
            >
              {showInitial && getAvatarInitial(name)}
            </span>
          )
        }}
      />
      <AvatarImage src={src || undefined} alt="" />
    </Avatar>
  )
}
