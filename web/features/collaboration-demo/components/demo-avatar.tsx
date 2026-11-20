import type { AvatarSize } from '@langgenius/dify-ui/avatar'
import type { DemoUserId } from '../demo-users'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { demoUsers } from '../demo-users'

type DemoAvatarProps = {
  user: DemoUserId
  size?: AvatarSize
  className?: string
}

export function DemoAvatar({ user, size = 'sm', className }: DemoAvatarProps) {
  return (
    <Avatar
      size={size}
      aria-hidden="true"
      className={cn('ring-1 ring-components-panel-bg', className)}
    >
      <AvatarFallback style={{ backgroundColor: demoUsers[user].color }}>
        {demoUsers[user].name[0]}
      </AvatarFallback>
    </Avatar>
  )
}
