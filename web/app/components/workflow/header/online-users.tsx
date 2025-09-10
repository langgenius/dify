'use client'
import { useEffect, useState } from 'react'
import Avatar from '@/app/components/base/avatar'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { useStore } from '../store'
import cn from '@/utils/classnames'
import { ChevronDown } from '@/app/components/base/icons/src/vender/solid/arrows'
import { getUserColor } from '../collaboration/utils/user-color'
import Tooltip from '@/app/components/base/tooltip'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useAppContext } from '@/context/app-context'
import { getAvatar } from '@/service/common'

const useAvatarUrls = (users: any[]) => {
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const fetchAvatars = async () => {
      const newAvatarUrls: Record<string, string> = {}

      await Promise.all(
        users.map(async (user) => {
          if (user.avatar) {
            try {
              const response = await getAvatar({ avatar: user.avatar })
              newAvatarUrls[user.sid] = response.avatar_url
            }
 catch (error) {
              console.error('Failed to fetch avatar:', error)
              newAvatarUrls[user.sid] = user.avatar
            }
          }
        }),
      )

      setAvatarUrls(newAvatarUrls)
    }

    if (users.length > 0)
      fetchAvatars()
  }, [users])

  return avatarUrls
}

const OnlineUsers = () => {
  const appId = useStore(s => s.appId)
  const { onlineUsers } = useCollaboration(appId)
  const { userProfile } = useAppContext()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const avatarUrls = useAvatarUrls(onlineUsers || [])

  const currentUserId = userProfile?.id

  if (!onlineUsers || onlineUsers.length === 0)
    return null

  // Display logic:
  // 1-3 users: show all avatars
  // 4+ users: show 2 avatars + count + arrow
  const shouldShowCount = onlineUsers.length >= 4
  const maxVisible = shouldShowCount ? 2 : 3
  const visibleUsers = onlineUsers.slice(0, maxVisible)
  const remainingCount = onlineUsers.length - maxVisible

  const getAvatarUrl = (user: any) => {
    return avatarUrls[user.sid] || user.avatar
  }

  return (
    <div className="flex items-center rounded-full bg-white px-1 py-1">
      <div className="flex items-center">
        <div className="flex items-center -space-x-2">
          {visibleUsers.map((user, index) => {
            const isCurrentUser = user.user_id === currentUserId
            const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
            const displayName = isCurrentUser
              ? `${user.username || 'User'} (You)`
              : (user.username || 'User')

            return (
              <Tooltip
                key={`${user.sid}-${index}`}
                popupContent={displayName}
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
                    avatar={getAvatarUrl(user)}
                    size={28}
                    className="ring-2 ring-white"
                    backgroundColor={userColor}
                  />
                </div>
              </Tooltip>
            )
          })}
          {remainingCount > 0 && (
            <PortalToFollowElem
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
              placement="bottom-start"
            >
              <PortalToFollowElemTrigger
                onMouseEnter={() => setDropdownOpen(true)}
                onMouseLeave={() => setDropdownOpen(false)}
                asChild
              >
                <div className="flex items-center">
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
                  <ChevronDown className="ml-1 h-3 w-3 text-gray-500" />
                </div>
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent
                onMouseEnter={() => setDropdownOpen(true)}
                onMouseLeave={() => setDropdownOpen(false)}
                className="z-[9999]"
              >
                <div className="mt-2 min-w-[200px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg p-1 shadow-lg">
                  {onlineUsers.map((user) => {
                    const isCurrentUser = user.user_id === currentUserId
                    const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
                    const displayName = isCurrentUser
                      ? `${user.username || 'User'} (You)`
                      : (user.username || 'User')

                    return (
                      <div
                        key={user.sid}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-components-panel-on-panel-item-bg-hover"
                      >
                        <Avatar
                          name={user.username || 'User'}
                          avatar={getAvatarUrl(user)}
                          size={24}
                          backgroundColor={userColor}
                        />
                        <span className="text-sm text-text-secondary">
                          {displayName}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>
          )}
        </div>
      </div>
    </div>
  )
}

export default OnlineUsers
