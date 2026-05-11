'use client'
import type { OnlineUser } from '../collaboration/types/collaboration'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { useAppContext } from '@/context/app-context'
import { getAvatar } from '@/service/common'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { getUserColor } from '../collaboration/utils/user-color'
import { useStore } from '../store'

const useAvatarUrls = (users: OnlineUser[]) => {
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
  const { t } = useTranslation()
  const appId = useStore(s => s.appId)
  const { onlineUsers, cursors, isEnabled: isCollaborationEnabled } = useCollaboration(appId as string)
  const { userProfile } = useAppContext()
  const reactFlow = useReactFlow()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const avatarUrls = useAvatarUrls(onlineUsers || [])

  const currentUserId = userProfile?.id
  const fallbackUsername = t('comments.fallback.user', { ns: 'workflow' })
  const currentUserSuffix = t('members.you', { ns: 'common' })

  const renderDisplayName = (
    user: OnlineUser,
    baseClassName: string,
    suffixClassName: string,
  ) => {
    const baseName = user.username || fallbackUsername
    const isCurrentUser = user.user_id === currentUserId

    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1', baseClassName)}>
        <span className="truncate">{baseName}</span>
        {isCurrentUser && (
          <span className={cn('shrink-0', suffixClassName)}>
            {currentUserSuffix}
          </span>
        )}
      </span>
    )
  }

  // Function to jump to user's cursor position
  const jumpToUserCursor = (userId: string) => {
    const cursor = cursors[userId]
    if (!cursor)
      return

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

  const getAvatarUrl = (user: OnlineUser) => {
    return avatarUrls[user.sid] || user.avatar
  }

  const hasCounter = remainingCount > 0

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-full border-[0.5px] border-components-panel-border',
        'bg-components-panel-bg py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]',
        hasCounter ? 'min-w-[87px] gap-px pr-1.5 pl-1' : 'gap-1 px-1.5',
      )}
    >
      <div className="flex h-6 items-center">
        <div className="flex items-center">
          {visibleUsers.map((user, index) => {
            const isCurrentUser = user.user_id === currentUserId
            const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
            const avatarUrl = getAvatarUrl(user)
            const displayName = user.username || fallbackUsername
            return (
              <Tooltip key={`${user.sid}-${index}`}>
                <TooltipTrigger>
                  <div
                    className={cn(
                      'relative flex size-6 items-center justify-center',
                      index > 0 && '-ml-1.5',
                      !isCurrentUser && 'cursor-pointer transition-transform hover:scale-110',
                    )}
                    style={{ zIndex: visibleUsers.length - index }}
                    onClick={() => !isCurrentUser && jumpToUserCursor(user.user_id)}
                  >
                    <AvatarRoot size="sm" className="ring-1 ring-components-panel-bg">
                      {avatarUrl && (
                        <AvatarImage
                          src={avatarUrl}
                          alt={displayName}
                        />
                      )}
                      <AvatarFallback
                        size="sm"
                        style={userColor ? { backgroundColor: userColor } : undefined}
                      >
                        {displayName?.[0]?.toLocaleUpperCase()}
                      </AvatarFallback>
                    </AvatarRoot>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  placement="bottom"
                  sideOffset={4}
                  className="flex h-[28px] max-w-[220px] min-w-0 items-center justify-center rounded-md border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-3 py-[6px] shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
                >
                  {renderDisplayName(
                    user,
                    'max-w-full system-xs-medium text-text-secondary',
                    'text-text-quaternary',
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
          {remainingCount > 0 && (
            <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
              <PopoverTrigger
                render={(
                  <div className="flex items-center gap-1">
                    <div
                      className={cn(
                        'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-components-icon-bg-midnight-solid text-[10px] leading-[12px] font-semibold text-white uppercase ring-1 ring-components-panel-bg select-none',
                        visibleUsers.length > 0 && '-ml-1',
                      )}
                    >
                      +
                      {remainingCount}
                    </div>
                    <ChevronDownIcon className="h-3 w-3 cursor-pointer text-gray-500" />
                  </div>
                )}
              />
              <PopoverContent
                placement="bottom-start"
                sideOffset={8}
                alignOffset={-48}
                popupClassName={cn(
                  'mt-1.5 flex max-h-[200px] w-[240px] flex-col overflow-y-auto',
                  'rounded-xl border-[0.5px] border-components-panel-border',
                  'bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]',
                )}
              >
                {onlineUsers.map((user) => {
                  const isCurrentUser = user.user_id === currentUserId
                  const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
                  const avatarUrl = getAvatarUrl(user)
                  const displayName = user.username || fallbackUsername
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
                        <AvatarRoot size="sm">
                          {avatarUrl && (
                            <AvatarImage
                              src={avatarUrl}
                              alt={displayName}
                            />
                          )}
                          <AvatarFallback
                            size="sm"
                            style={userColor ? { backgroundColor: userColor } : undefined}
                          >
                            {displayName?.[0]?.toLocaleUpperCase()}
                          </AvatarFallback>
                        </AvatarRoot>
                      </div>
                      {renderDisplayName(
                        user,
                        'system-xs-medium text-text-secondary',
                        'text-text-tertiary',
                      )}
                    </div>
                  )
                })}
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  )
}

export default OnlineUsers
