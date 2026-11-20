'use client'

import type { OnlineUser } from '../collaboration/types/collaboration'
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
  const { t } = useTranslation(['billing', 'workspaceMembers', 'workflowComments', 'workflow'])
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
      <span className={cn('inline-flex min-w-0 items-center', baseClassName)}>
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

  const shouldShowCount = onlineUsers.length > 3
  const visibleUsers = onlineUsers.slice(0, shouldShowCount ? 2 : 3)
  const remainingCount = onlineUsers.length - visibleUsers.length

  const renderAvatar = (user: OnlineUser) => {
    const isCurrentUser = user.user_id === currentUserId
    const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
    const avatarUrl = isConnected ? avatarUrls?.[user.sid] : undefined
    return (
      <Avatar size="sm" aria-hidden="true" className="ring-1 ring-components-panel-bg">
        <AvatarFallback style={userColor ? { backgroundColor: userColor } : undefined}>
          {getAvatarInitial(user.username || fallbackUsername)}
        </AvatarFallback>
        <AvatarImage src={avatarUrl || undefined} alt="" />
      </Avatar>
    )
  }

  const renderNameTooltip = (user: OnlineUser) => (
    <TooltipContent side="bottom" sideOffset={4} className="max-w-55">
      {user.username || fallbackUsername}
      {user.user_id === currentUserId && (
        <span className="font-normal text-text-tertiary">{currentUserSuffix}</span>
      )}
    </TooltipContent>
  )

  const pillClassName =
    'flex items-center gap-px rounded-2xl border-[0.5px] border-components-panel-border py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]'

  if (!shouldShowCount) {
    return (
      <div className={cn(pillClassName, 'bg-components-panel-bg-blur px-1')}>
        {visibleUsers.map((user, index) => {
          const isCurrentUser = user.user_id === currentUserId
          const displayName = user.username || fallbackUsername
          const triggerClassName = cn(
            'relative flex size-6 items-center justify-center rounded-full',
            index > 0 && '-ms-1',
            !isCurrentUser &&
              'cursor-pointer transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
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
                      {renderAvatar(user)}
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={displayName}
                      className={triggerClassName}
                      style={triggerStyle}
                      onClick={() => jumpToUserCursor(user.user_id)}
                    >
                      {renderAvatar(user)}
                    </button>
                  )
                }
              />
              {renderNameTooltip(user)}
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <Popover
      open={dropdownOpen}
      onOpenChange={(open) => {
        if (open && avatarAppId) void refetchAvatars()
        setDropdownOpen(open)
      }}
    >
      <PopoverTrigger
        aria-label={t(($) => $['collaboration.viewCollaborators'], {
          ns: 'workflow',
          count: onlineUsers.length,
        })}
        className={cn(
          pillClassName,
          'cursor-pointer bg-components-panel-bg ps-1 pe-1.5 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        )}
      >
        {visibleUsers.map((user, index) => (
          <Tooltip key={user.sid}>
            <TooltipTrigger
              render={
                <span
                  className={cn('relative flex size-6', index > 0 && '-ms-1')}
                  style={{ zIndex: visibleUsers.length - index }}
                />
              }
            >
              {renderAvatar(user)}
            </TooltipTrigger>
            {renderNameTooltip(user)}
          </Tooltip>
        ))}
        <span
          aria-hidden
          className="-ms-1 flex size-6 items-center justify-center rounded-full bg-components-icon-bg-midnight-solid text-2xs leading-3 font-semibold text-white ring-1 ring-components-panel-bg select-none"
        >
          +{remainingCount}
        </span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-3 text-text-tertiary" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="flex max-h-50 w-60 flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
      >
        {onlineUsers.map((user) => {
          const isCurrentUser = user.user_id === currentUserId
          const userColor = isCurrentUser ? undefined : getUserColor(user.user_id)
          const avatarUrl = isConnected && !isFetchingAvatars ? avatarUrls?.[user.sid] : undefined
          const displayName = user.username || fallbackUsername
          return (
            <button
              type="button"
              key={user.sid}
              disabled={isCurrentUser}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg py-1 ps-2 pe-3 text-start focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
                !isCurrentUser && 'cursor-pointer hover:bg-state-base-hover',
              )}
              onClick={() => {
                jumpToUserCursor(user.user_id)
                setDropdownOpen(false)
              }}
            >
              <Avatar size="sm" aria-hidden="true">
                <AvatarFallback style={userColor ? { backgroundColor: userColor } : undefined}>
                  {getAvatarInitial(displayName)}
                </AvatarFallback>
                <AvatarImage src={avatarUrl || undefined} alt="" />
              </Avatar>
              {renderDisplayName(
                user,
                'system-sm-regular text-text-primary',
                'system-xs-regular text-text-tertiary',
              )}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

export default OnlineUsers
