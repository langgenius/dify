'use client'
import Avatar from '@/app/components/base/avatar'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { useStore } from '../store'
import cn from '@/utils/classnames'

const OnlineUsers = () => {
  const appId = useStore(s => s.appId)
  const { onlineUsers } = useCollaboration(appId)

  if (!onlineUsers || onlineUsers.length === 0)
    return null

  // Show max 2 avatars directly, rest as count
  const visibleUsers = onlineUsers.slice(0, 2)
  const remainingCount = onlineUsers.length - 2

  return (
    <div className="flex items-center -space-x-2">
      {visibleUsers.map((user, index) => (
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
          />
        </div>
      ))}
      {remainingCount > 0 && (
        <div
          className={cn(
            'flex items-center justify-center',
            'h-7 w-7 rounded-full bg-gray-300',
            'text-xs font-medium text-gray-700',
            'ring-2 ring-white',
          )}
        >
          +{remainingCount}
        </div>
      )}
    </div>
  )
}

export default OnlineUsers
