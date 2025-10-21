'use client'
import { useEffect, useState } from 'react'
import { useReactFlow } from 'reactflow'
import Avatar from '@/app/components/base/avatar'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { useStore } from '../store'
import cn from '@/utils/classnames'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
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
  const { onlineUsers, cursors, isEnabled: isCollaborationEnabled } = useCollaboration(appId as string)
  const { userProfile } = useAppContext()
  const reactFlow = useReactFlow()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const avatarUrls = useAvatarUrls(onlineUsers || [])

  const currentUserId = userProfile?.id

  const renderDisplayName = (
    user: any,
    baseClassName: string,
    suffixClassName: string,
  ) => {
    const baseName = user.username || 'User'
    const isCurrentUser = user.user_id === currentUserId

    return (
      <span className={cn('inline-flex items-center gap-1', baseClassName)}>
        <span>{baseName}</span>
        {isCurrentUser && (
          <span className={suffixClassName}>
            (You)
          </span>
        )}
      </span>
    )
  }

  // Function to jump to user's cursor position
  const jumpToUserCursor = (userId: string) => {
    const cursor = cursors[userId]
    if (!cursor) return

    // Convert world coordinates to center the view on the cursor
    reactFlow.setCenter(cursor.x, cursor.y, { zoom: 1, duration: 800 })
  }

  if (!isCollaborationEnabled || !onlineUsers || onlineUsers.length === 0)
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

  const hasCounter = remainingCount > 0

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-full border-[0.5px] border-components-panel-border',
        'bg-components-panel-bg py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]',
        hasCounter ? 'min-w-[87px] gap-px pl-1 pr-1.5' : 'gap-1 px-1.5',
      )}
    >
      <div className="flex h-6 items-center">
        <div className="flex items-center">
          {visibleUsers.map((user, index) => {
            const isCurrentUser = user.user_id === currentUserId
            const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
            return (
              <Tooltip
                key={`${user.sid}-${index}`}
                popupContent={renderDisplayName(
                  user,
                  'system-xs-medium text-text-secondary',
                  'text-text-quaternary',
                )}
                position="bottom"
                triggerMethod="hover"
                needsDelay={false}
                asChild
                popupClassName="flex h-[28px] w-[85px] items-center justify-center gap-1 rounded-md border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-3 py-[6px] shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
                noDecoration
              >
                <div
                  className={cn(
                    'relative flex size-6 items-center justify-center',
                    index > 0 && '-ml-1.5',
                    !isCurrentUser && 'cursor-pointer transition-transform hover:scale-110',
                  )}
                  style={{ zIndex: visibleUsers.length - index }}
                  onClick={() => !isCurrentUser && jumpToUserCursor(user.user_id)}
                >
                  <Avatar
                    name={user.username || 'User'}
                    avatar={getAvatarUrl(user)}
                    size={24}
                    className="ring-1 ring-components-panel-bg"
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
              offset={{
                mainAxis: 8,
                crossAxis: -48,
              }}
            >
              <PortalToFollowElemTrigger
                onClick={() => setDropdownOpen(prev => !prev)}
                asChild
              >
                <div className="flex items-center gap-1">
                  <div
                    className={cn(
                      'flex h-6 w-6 cursor-pointer select-none items-center justify-center rounded-full bg-components-icon-bg-midnight-solid text-[10px] font-semibold uppercase leading-[12px] text-white ring-1 ring-components-panel-bg',
                      visibleUsers.length > 0 && '-ml-1',
                    )}
                  >
                    +{remainingCount}
                  </div>
                  <ChevronDownIcon className="h-3 w-3 cursor-pointer text-gray-500" />
                </div>
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent
                className="z-[9999]"
              >
                <div
                  className={cn(
                    'mt-1.5',
                    'flex flex-col',
                    'max-h-[200px] w-[240px] overflow-y-auto',
                    'rounded-xl border-[0.5px] border-components-panel-border',
                    'bg-components-panel-bg-blur p-1',
                    'shadow-lg shadow-shadow-shadow-5',
                    'backdrop-blur-[10px]',
                  )}
                >
                  {onlineUsers.map((user) => {
                    const isCurrentUser = user.user_id === currentUserId
                    const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
                    return (
                      <div
                        key={user.sid}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-3 py-1.5',
                          !isCurrentUser && 'cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover',
                        )}
                        onClick={() => {
                          if (!isCurrentUser) {
                            jumpToUserCursor(user.user_id)
                            setDropdownOpen(false)
                          }
                        }}
                      >
                        <div className="relative">
                          <Avatar
                            name={user.username || 'User'}
                            avatar={getAvatarUrl(user)}
                            size={24}
                            backgroundColor={userColor}
                          />
                        </div>
                        {renderDisplayName(
                          user,
                          'system-xs-medium text-text-secondary',
                          'text-text-tertiary',
                        )}
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
