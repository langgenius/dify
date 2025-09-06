'use client'
import Avatar from '@/app/components/base/avatar'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { useStore } from '../store'
import cn from '@/utils/classnames'
import { ChevronDown } from '@/app/components/base/icons/src/vender/solid/arrows'

const getUserColor = (id: string) => {
  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']
  const hash = id.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0)
    return a & a
  }, 0)
  return colors[Math.abs(hash) % colors.length]
}

const OnlineUsers = () => {
  const appId = useStore(s => s.appId)
  const { onlineUsers } = useCollaboration(appId)

  if (!onlineUsers || onlineUsers.length === 0)
    return null

  // Display logic:
  // 1-3 users: show all avatars
  // 4+ users: show 2 avatars + count + arrow
  const shouldShowCount = onlineUsers.length >= 4
  const maxVisible = shouldShowCount ? 2 : 3
  const visibleUsers = onlineUsers.slice(0, maxVisible)
  const remainingCount = onlineUsers.length - maxVisible

  return (
    <div className="flex items-center rounded-full bg-white px-1 py-1">
      <div className="flex items-center">
        <div className="flex items-center -space-x-2">
          {visibleUsers.map((user, index) => {
            const userColor = getUserColor(user.user_id)
            return (
              <div
                key={`${user.sid}-${index}`}
                className="relative"
                style={{ zIndex: visibleUsers.length - index }}
              >
                <Avatar
                  name={user.username || 'User'}
                  avatar={user.avatar}
                  size={28}
                  className="ring-2 ring-white"
                  backgroundColor={userColor}
                />
              </div>
            )
          })}
          {remainingCount > 0 && (
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center',
                'rounded-full bg-gray-300',
                'text-xs font-medium text-gray-700',
                'ring-2 ring-white',
              )}
            >
              +{remainingCount}
            </div>
          )}
        </div>
        {remainingCount > 0 && (
          <ChevronDown className="ml-1 h-3 w-3 text-gray-500" />
        )}
      </div>
    </div>
  )
}

export default OnlineUsers
