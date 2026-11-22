import type { AvatarSize } from '@langgenius/dify-ui/avatar'
import type { FC } from 'react'
import { AvatarGroup, AvatarGroupCount } from '@langgenius/dify-ui/avatar'
import { uniqBy } from 'es-toolkit'
import { memo } from 'react'
import { CollaboratorAvatar } from '@/app/components/workflow/collaboration/components/collaborator-avatar'

type User = {
  id: string
  name: string
  avatar_url?: string | null
}

type UserAvatarListProps = {
  users: User[]
  maxVisible?: number
  size?: AvatarSize
  className?: string
  showCount?: boolean
}

export const UserAvatarList: FC<UserAvatarListProps> = memo(
  ({ users, maxVisible = 3, size = 'sm', className = '', showCount = true }) => {
    const uniqueUsers = uniqBy(users, (user) => user.id)
    if (!uniqueUsers.length) return null

    const shouldShowCount = showCount && uniqueUsers.length > maxVisible
    const actualMaxVisible = shouldShowCount ? Math.max(1, maxVisible - 1) : maxVisible
    const visibleUsers = uniqueUsers.slice(0, actualMaxVisible)
    const remainingCount = uniqueUsers.length - actualMaxVisible

    return (
      <AvatarGroup size={size} className={className}>
        {visibleUsers.map((user, index) => (
          <CollaboratorAvatar
            key={user.id}
            collaborator={{ id: user.id, name: user.name, avatarUrl: user.avatar_url }}
            role="img"
            aria-hidden={undefined}
            aria-label={user.name}
            style={{ zIndex: visibleUsers.length - index }}
          />
        ))}
        {shouldShowCount && remainingCount > 0 && (
          <AvatarGroupCount>+{remainingCount}</AvatarGroupCount>
        )}
      </AvatarGroup>
    )
  },
)

UserAvatarList.displayName = 'UserAvatarList'
