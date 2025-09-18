import type { FC } from 'react'
import { memo } from 'react'
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
  if (!users.length) return null

  const shouldShowCount = showCount && users.length > maxVisible
  const actualMaxVisible = shouldShowCount ? Math.max(1, maxVisible - 1) : maxVisible
  const visibleUsers = users.slice(0, actualMaxVisible)
  const remainingCount = users.length - actualMaxVisible

  return (
    <div className={`flex items-center -space-x-1 ${className}`}>
      {visibleUsers.map((user, index) => (
        <div
          key={`${user.id}-${index}`}
          className='relative'
          style={{ zIndex: visibleUsers.length - index }}
        >
          <Avatar
            name={user.name}
            avatar={user.avatar_url || null}
            size={size}
            className='ring-2 ring-white'
          />
        </div>
      ))}
      {shouldShowCount && remainingCount > 0 && (
        <div
          className={'flex items-center justify-center rounded-full bg-components-panel-on-panel-item-bg text-[10px] leading-none text-text-secondary ring-2 ring-white'}
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
