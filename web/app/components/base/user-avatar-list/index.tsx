import type { AvatarSize } from '@langgenius/dify-ui/avatar'
import type { FC } from 'react'
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@langgenius/dify-ui/avatar'
import { useSuspenseQuery } from '@tanstack/react-query'
import { uniqBy } from 'es-toolkit'
import { memo } from 'react'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { userProfileQueryOptions } from '@/features/account-profile/client'
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
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const uniqueUsers = uniqBy(users, (user) => user.id)
    if (!uniqueUsers.length) return null

    const shouldShowCount = showCount && uniqueUsers.length > maxVisible
    const actualMaxVisible = shouldShowCount ? Math.max(1, maxVisible - 1) : maxVisible
    const visibleUsers = uniqueUsers.slice(0, actualMaxVisible)
    const remainingCount = uniqueUsers.length - actualMaxVisible

    return (
      <AvatarGroup size={size} className={className}>
        {visibleUsers.map((user, index) => {
          const isCurrentUser = user.id === currentUserId
          const userColor = isCurrentUser ? undefined : getUserColor(user.id)
          return (
            <Avatar
              key={user.id}
              role="img"
              aria-label={user.name}
              style={{ zIndex: visibleUsers.length - index }}
            >
              <AvatarFallback style={userColor ? { backgroundColor: userColor } : undefined}>
                {getAvatarInitial(user.name)}
              </AvatarFallback>
              <AvatarImage src={user.avatar_url || undefined} alt="" />
            </Avatar>
          )
        })}
        {shouldShowCount && remainingCount > 0 && (
          <AvatarGroupCount>+{remainingCount}</AvatarGroupCount>
        )}
      </AvatarGroup>
    )
  },
)

UserAvatarList.displayName = 'UserAvatarList'
