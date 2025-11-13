import type { FC } from 'react'
import { memo } from 'react'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { useAppContext } from '@/context/app-context'
import Avatar from '@/app/components/base/avatar'

type User = {
  id: string
  name: string
  avatar_url?: string | null
}

type UserAvatarListProps = {
  users: User[]
  maxVisible?: number
  size?: number
  className?: string
  showCount?: boolean
}

export const UserAvatarList: FC<UserAvatarListProps> = memo(({
  users,
  maxVisible = 3,
  size = 24,
  className = '',
  showCount = true,
}) => {
  const { userProfile } = useAppContext()
  if (!users.length) return null

  const shouldShowCount = showCount && users.length > maxVisible
  const actualMaxVisible = shouldShowCount ? Math.max(1, maxVisible - 1) : maxVisible
  const visibleUsers = users.slice(0, actualMaxVisible)
  const remainingCount = users.length - actualMaxVisible

  const currentUserId = userProfile?.id

  return (
    <div className={`flex items-center -space-x-1 ${className}`}>
      {visibleUsers.map((user, index) => {
        const isCurrentUser = user.id === currentUserId
        const userColor = isCurrentUser ? undefined : getUserColor(user.id)
        return (
          <div
            key={`${user.id}-${index}`}
            className='relative'
            style={{ zIndex: visibleUsers.length - index }}
          >
            <Avatar
              name={user.name}
              avatar={user.avatar_url || null}
              size={size}
              className='ring-2 ring-components-panel-bg'
              backgroundColor={userColor}
            />
          </div>
        )
      },

      )}
      {shouldShowCount && remainingCount > 0 && (
        <div
          className={'flex items-center justify-center rounded-full bg-gray-500 text-[10px] leading-none text-white ring-2 ring-components-panel-bg'}
          style={{
            zIndex: 0,
            width: size,
            height: size,
          }}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  )
})

UserAvatarList.displayName = 'UserAvatarList'
