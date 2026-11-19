'use client'

import type { OnlineUser } from '../collaboration/types/collaboration'
import { ChevronDownIcon } from '@heroicons/react/20/solid'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { queryOptions, skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { getAvatarInitial } from '@/utils/avatar'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import { collaborationUpgradeDialogAtom } from '../collaboration/upgrade-state'
import { getUserColor } from '../collaboration/utils/user-color'
import { useHooksStore } from '../hooks-store'

const OnlineUsers = () => {
  const { t } = useTranslation(['billing', 'workspaceMembers', 'workflowComments'])
  const appId = useAtomValue(editorAppIdAtom)
  const upgradeDialog = useAtomValue(collaborationUpgradeDialogAtom)
  const canEdit = useHooksStore((s) => s.accessControl.canEdit)
  const {
    onlineUsers,
    cursors,
    isConnected,
    isEnabled: isCollaborationEnabled,
  } = useCollaboration(appId, canEdit)
  const { data: currentUser } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: ({ profile: { id, name, avatar_url } }) => ({ id, name, avatarUrl: avatar_url }),
  })
  const currentUserId = currentUser.id
  const reactFlow = useReactFlow()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const avatarAppId =
    isConnected &&
    isCollaborationEnabled &&
    !upgradeDialog &&
    onlineUsers.some((user) => user.avatar)
      ? appId
      : undefined
  const {
    data: avatarUrls,
    isFetching: isFetchingAvatars,
    refetch: refetchAvatars,
  } = useQuery(
    queryOptions({
      queryKey: [
        'workflow-collaboration-avatars',
        avatarAppId,
        onlineUsers.map((user) => user.sid),
      ],
      queryFn: avatarAppId
        ? () => collaborationManager.getOnlineUserAvatars(avatarAppId)
        : skipToken,
      gcTime: 0,
      retry: false,
    }),
  )

  const fallbackUsername = t(($) => $['comments.fallback.user'], { ns: 'workflowComments' })
  const currentUserSuffix = t(($) => $['members.you'], { ns: 'workspaceMembers' })

  const renderDisplayName = (user: OnlineUser, baseClassName: string, suffixClassName: string) => {
    const baseName = user.username || fallbackUsername
    const isCurrentUser = user.user_id === currentUserId

    return (
      <span className={cn('inline-flex min-w-0 items-center gap-1', baseClassName)}>
        <span className="truncate">{baseName}</span>
        {isCurrentUser && (
          <span className={cn('shrink-0', suffixClassName)}>{currentUserSuffix}</span>
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

  if (upgradeDialog) {
    const collaborationLabel = t(($) => $['upgrade.workflowCollaboration.label'], { ns: 'billing' })

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              handle={upgradeDialog}
              aria-label={collaborationLabel}
              className="flex h-8 cursor-pointer items-center rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg px-1.5 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px] hover:bg-state-base-hover"
            >
              <Avatar size="sm" aria-hidden="true" className="ring-1 ring-components-panel-bg">
                <AvatarFallback>
                  {getAvatarInitial(currentUser.name || fallbackUsername)}
                </AvatarFallback>
                <AvatarImage src={currentUser.avatarUrl || undefined} alt="" />
              </Avatar>
            </DialogTrigger>
          }
        />
        <TooltipContent side="bottom" sideOffset={4}>
          {collaborationLabel}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (!isCollaborationEnabled || !onlineUsers || onlineUsers.length === 0) return null

  // Display logic:
  // 1-3 users: show all avatars
  // 4+ users: show 2 avatars + count + arrow
  const shouldShowCount = onlineUsers.length >= 4
  const maxVisible = shouldShowCount ? 2 : 3
  const visibleUsers = onlineUsers.slice(0, maxVisible)
  const remainingCount = onlineUsers.length - maxVisible

  const hasCounter = remainingCount > 0

  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-full border-[0.5px] border-components-panel-border',
        'bg-components-panel-bg py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]',
        hasCounter ? 'min-w-21.75 gap-px ps-1 pe-1.5' : 'gap-1 px-1.5',
      )}
    >
      <div className="flex h-6 items-center">
        <div className="flex items-center">
          {visibleUsers.map((user, index) => {
            const isCurrentUser = user.user_id === currentUserId
            const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
            const avatarUrl = isConnected ? avatarUrls?.[user.sid] : undefined
            const displayName = user.username || fallbackUsername
            const avatar = (
              <Avatar size="sm" aria-hidden="true" className="ring-1 ring-components-panel-bg">
                <AvatarFallback style={userColor ? { backgroundColor: userColor } : undefined}>
                  {getAvatarInitial(displayName)}
                </AvatarFallback>
                <AvatarImage src={avatarUrl || undefined} alt="" />
              </Avatar>
            )
            const triggerClassName = cn(
              'relative flex size-6 items-center justify-center',
              index > 0 && '-ms-1.5',
              !isCurrentUser && 'cursor-pointer transition-transform hover:scale-110',
            )
            const triggerStyle = { zIndex: visibleUsers.length - index }
            return (
              <Tooltip key={user.sid}>
                <TooltipTrigger
                  render={
                    isCurrentUser ? (
                      <div
                        role="img"
                        aria-label={displayName}
                        className={triggerClassName}
                        style={triggerStyle}
                      >
                        {avatar}
                      </div>
                    ) : (
                      <button
                        type="button"
                        aria-label={displayName}
                        className={triggerClassName}
                        style={triggerStyle}
                        onClick={() => jumpToUserCursor(user.user_id)}
                      >
                        {avatar}
                      </button>
                    )
                  }
                />
                <TooltipContent side="bottom" sideOffset={4} className="max-w-55">
                  {displayName}
                  {isCurrentUser && (
                    <span className="ms-1 text-text-quaternary">{currentUserSuffix}</span>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          })}
          {remainingCount > 0 && (
            <Popover
              open={dropdownOpen}
              onOpenChange={(open) => {
                if (open && avatarAppId) void refetchAvatars()
                setDropdownOpen(open)
              }}
            >
              <PopoverTrigger
                render={
                  <div className="flex items-center gap-1">
                    <div
                      className={cn(
                        'flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-components-icon-bg-midnight-solid text-2xs leading-3 font-semibold text-white uppercase ring-1 ring-components-panel-bg select-none',
                        visibleUsers.length > 0 && '-ms-1',
                      )}
                    >
                      +{remainingCount}
                    </div>
                    <ChevronDownIcon className="size-3 cursor-pointer text-gray-500" />
                  </div>
                }
              />
              <PopoverContent
                align="start"
                alignOffset={-48}
                className={cn(
                  'mt-1.5 flex max-h-50 w-60 flex-col overflow-y-auto',
                  'rounded-xl border-[0.5px] border-components-panel-border',
                  'bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]',
                )}
              >
                {onlineUsers.map((user) => {
                  const isCurrentUser = user.user_id === currentUserId
                  const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
                  const avatarUrl =
                    isConnected && !isFetchingAvatars ? avatarUrls?.[user.sid] : undefined
                  const displayName = user.username || fallbackUsername
                  return (
                    <button
                      type="button"
                      key={user.sid}
                      disabled={isCurrentUser}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-start',
                        !isCurrentUser &&
                          'cursor-pointer hover:bg-components-panel-on-panel-item-bg-hover',
                      )}
                      onClick={() => {
                        jumpToUserCursor(user.user_id)
                        setDropdownOpen(false)
                      }}
                    >
                      <div className="relative">
                        <Avatar size="sm" aria-hidden="true">
                          <AvatarFallback
                            style={userColor ? { backgroundColor: userColor } : undefined}
                          >
                            {getAvatarInitial(displayName)}
                          </AvatarFallback>
                          <AvatarImage src={avatarUrl || undefined} alt="" />
                        </Avatar>
                      </div>
                      {renderDisplayName(
                        user,
                        'system-xs-medium text-text-secondary',
                        'text-text-tertiary',
                      )}
                    </button>
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
