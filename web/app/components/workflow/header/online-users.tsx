'use client'
import Avatar from '@/app/components/base/avatar'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { useStore } from '../store'
import cn from '@/utils/classnames'
import { ChevronDown } from '@/app/components/base/icons/src/vender/solid/arrows'
import { getUserColor } from '../collaboration/utils/user-color'
import Tooltip from '@/app/components/base/tooltip'

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
              <Tooltip
                key={`${user.sid}-${index}`}
                popupContent={user.username || 'User'}
                position="bottom"
                triggerMethod="hover"
                needsDelay={false}
                asChild
              >
                <div
                  className="relative cursor-pointer"
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
              </Tooltip>
            )
          })}
          {remainingCount > 0 && (
            <Tooltip
              popupContent={
                <div className="flex flex-col gap-1">
                  {onlineUsers.slice(maxVisible).map((user, index) => (
                    <div key={`${user.sid}-tooltip-${index}`}>
                      {user.username || 'User'}
                    </div>
                  ))}
                </div>
              }
              position="bottom"
              triggerMethod="hover"
              needsDelay={false}
              asChild
            >
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center',
                  'cursor-pointer rounded-full bg-gray-300',
                  'text-xs font-medium text-gray-700',
                  'ring-2 ring-white',
                )}
              >
                +{remainingCount}
              </div>
            </Tooltip>
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
