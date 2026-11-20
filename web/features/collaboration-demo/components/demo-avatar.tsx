import type { AvatarSize } from '@langgenius/dify-ui/avatar'
import type { CSSProperties } from 'react'
import type { DemoUserId } from '../demo-users'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { demoUsers } from '../demo-users'

type DemoAvatarProps = {
  user: DemoUserId
  size?: AvatarSize
  stacked?: boolean
  className?: string
  style?: CSSProperties
}

export function DemoAvatar({ user, size = 'sm', stacked, className, style }: DemoAvatarProps) {
  return (
    <Avatar
      size={size}
      aria-hidden="true"
      data-stacked={stacked || undefined}
      className={cn('ring-1 ring-components-panel-bg', className)}
      style={style}
    >
      <AvatarFallback style={{ backgroundColor: demoUsers[user].color }}>
        {demoUsers[user].name[0]}
      </AvatarFallback>
    </Avatar>
  )
}
