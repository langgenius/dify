import type { FC } from 'react'
import type { AvatarSize } from '@/app/components/base/avatar'
import { memo } from 'react'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@/app/components/base/avatar'
import { getUserColor } from '@/app/components/workflow/collaboration/utils/user-color'
import { useAppContext } from '@/context/app-context'

type User = {
  id: string
  name: string
  avatar_url?: string | null
}

function numericPxToAvatarSize(px: number): AvatarSize {
  const candidates: { px: number, size: AvatarSize }[] = [
    { px: 16, size: 'xxs' },
    { px: 20, size: 'xs' },
    { px: 24, size: 'sm' },
    { px: 32, size: 'md' },
    { px: 36, size: 'lg' },
    { px: 40, size: 'xl' },
    { px: 48, size: '2xl' },
    { px: 64, size: '3xl' },
  ]
  let best = candidates[0]!
  let bestDist = Math.abs(px - best.px)
  for (const c of candidates) {
    const d = Math.abs(px - c.px)
    if (d < bestDist || (d === bestDist && c.px < best.px)) {
      best = c
      bestDist = d
    }
  }
  return best.size
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
  if (!users.length)
    return null

  const shouldShowCount = showCount && users.length > maxVisible
  const actualMaxVisible = shouldShowCount ? Math.max(1, maxVisible - 1) : maxVisible
  const visibleUsers = users.slice(0, actualMaxVisible)
  const remainingCount = users.length - actualMaxVisible

  const currentUserId = userProfile?.id
  const avatarSize = numericPxToAvatarSize(size)

  return (
    <div className={`flex items-center -space-x-1 ${className}`}>
      {visibleUsers.map((user, index) => {
        const isCurrentUser = user.id === currentUserId
        const userColor = isCurrentUser ? undefined : getUserColor(user.id)
        return (
          <div
            key={`${user.id}-${index}`}
            className="relative"
            style={{ zIndex: visibleUsers.length - index }}
          >
            <AvatarRoot size={avatarSize} className="ring-2 ring-components-panel-bg">
              {user.avatar_url && (
                <AvatarImage
                  src={user.avatar_url}
                  alt={user.name}
                />
              )}
              <AvatarFallback
                size={avatarSize}
                style={userColor ? { backgroundColor: userColor } : undefined}
              >
                {user.name?.[0]?.toLocaleUpperCase()}
              </AvatarFallback>
            </AvatarRoot>
          </div>
        )
      },

      )}
      {shouldShowCount && remainingCount > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-gray-500 text-[10px] leading-none text-white ring-2 ring-components-panel-bg"
          style={{
            zIndex: 0,
            width: size,
            height: size,
          }}
        >
          +
          {remainingCount}
        </div>
      )}
    </div>
  )
})

UserAvatarList.displayName = 'UserAvatarList'
