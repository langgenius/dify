import type { AvatarSize } from '@langgenius/dify-ui/avatar'
import type { FC } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { uniqBy } from 'es-toolkit'
import { memo } from 'react'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { useAvatarSrc } from '@/hooks/use-avatar-src'
import { getAvatarInitial } from '@/utils/avatar'

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
          <UserAvatar key={user.id} user={user} zIndex={visibleUsers.length - index} />
        ))}
        {shouldShowCount && remainingCount > 0 && (
          <AvatarGroupCount>+{remainingCount}</AvatarGroupCount>
        )}
      </AvatarGroup>
    )
  },
)

UserAvatarList.displayName = 'UserAvatarList'

function UserAvatar({ user, zIndex }: { user: User; zIndex: number }) {
  const { src, onLoadingStatusChange } = useAvatarSrc(user.avatar_url)
  return (
    <Avatar role="img" aria-label={user.name} style={{ zIndex }}>
      <AvatarFallback style={{ backgroundColor: getUserColor(user.id) }}>
        {getAvatarInitial(user.name)}
      </AvatarFallback>
      <AvatarImage src={src} alt="" onLoadingStatusChange={onLoadingStatusChange} />
    </Avatar>
  )
}
