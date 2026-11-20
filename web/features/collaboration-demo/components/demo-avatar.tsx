import type { DemoUserId } from '../demo-users'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { demoUsers } from '../demo-users'

export function DemoAvatar({ user, className }: { user: DemoUserId; className?: string }) {
  return (
    <Avatar
      size="sm"
      aria-hidden="true"
      className={cn('ring-1 ring-components-panel-bg', className)}
    >
      <AvatarFallback className="text-white" style={{ backgroundColor: demoUsers[user].color }}>
        {demoUsers[user].name[0]}
      </AvatarFallback>
    </Avatar>
  )
}
