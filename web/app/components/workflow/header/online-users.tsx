'use client'

import type { ReactElement } from 'react'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import type { OnlineUser } from '../collaboration/types/collaboration'
import { AvatarGroup } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { queryOptions, skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from 'reactflow'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { CollaboratorAvatar } from '../collaboration/components/collaborator-avatar'
import { CollaboratorPill } from '../collaboration/components/collaborator-pill'
import { collaborationManager } from '../collaboration/core/collaboration-manager'
import { useCollaboration } from '../collaboration/hooks/use-collaboration'
import {
  collaborationUpgradeDialogAtom,
  collaborationUpgradeOpenedAtom,
} from '../collaboration/upgrade-state'
import { getUserColor } from '../collaboration/utils/user-color'
import { useHooksStore } from '../hooks-store'

const OnlineUsers = () => {
  const { t } = useTranslation(['billing', 'workspaceMembers', 'workflowComments', 'workflow'])
  const appId = useAtomValue(editorAppIdAtom)
  const upgradeDialog = useAtomValue(collaborationUpgradeDialogAtom)
  const upgradeOpened = useSetAtom(collaborationUpgradeOpenedAtom)
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
    isConnected && isCollaborationEnabled && !upgradeDialog && onlineUsers.length > 0
      ? appId
      : undefined
  const { data: avatarUrls, refetch: refetchAvatars } = useQuery(
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
              onClick={() => upgradeOpened('canvas_avatar')}
              aria-label={collaborationLabel}
              className="flex h-8 cursor-pointer items-center rounded-full border-[0.5px] border-components-panel-border bg-components-panel-bg px-1.5 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px] hover:bg-state-base-hover"
            >
              <AvatarGroup size="sm">
                <CollaboratorAvatar
                  collaborator={{
                    id: currentUser.id,
                    name: currentUser.name || fallbackUsername,
                    avatarUrl: currentUser.avatarUrl,
                  }}
                />
              </AvatarGroup>
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

  const toCollaborator = (user: OnlineUser, avatarUrl: string | undefined): Collaborator => ({
    id: user.sid,
    name: user.username || fallbackUsername,
    avatarUrl,
    color: getUserColor(user.user_id),
  })
  const renderNameTooltip = (user: OnlineUser) => (
    <TooltipContent side="bottom" sideOffset={4} className="max-w-55">
      {user.username || fallbackUsername}
      {user.user_id === currentUserId && (
        <span className="font-normal text-text-tertiary">{currentUserSuffix}</span>
      )}
    </TooltipContent>
  )

  const renderPillAvatar = (user: OnlineUser, trigger: ReactElement) => (
    <Tooltip key={user.sid}>
      <TooltipTrigger render={trigger}>
        <CollaboratorAvatar
          collaborator={toCollaborator(user, isConnected ? avatarUrls?.[user.sid] : undefined)}
        />
      </TooltipTrigger>
      {renderNameTooltip(user)}
    </Tooltip>
  )

  if (!shouldShowCount) {
    return (
      <CollaboratorPill>
        {visibleUsers.map((user) =>
          renderPillAvatar(
            user,
            user.user_id === currentUserId ? (
              <div
                role="img"
                aria-label={user.username || fallbackUsername}
                className="relative flex rounded-full"
              />
            ) : (
              <button
                type="button"
                aria-label={user.username || fallbackUsername}
                className="relative flex cursor-pointer rounded-full transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                onClick={() => jumpToUserCursor(user.user_id)}
              />
            ),
          ),
        )}
      </CollaboratorPill>
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
        nativeButton={false}
        aria-label={t(($) => $['collaboration.viewCollaborators'], {
          ns: 'workflow',
          count: onlineUsers.length,
        })}
        render={
          <CollaboratorPill
            overflowCount={remainingCount}
            className="cursor-pointer hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            {visibleUsers.map((user) =>
              renderPillAvatar(user, <span className="relative flex rounded-full" />),
            )}
          </CollaboratorPill>
        }
      />
      <PopoverContent
        aria-label={t(($) => $['collaboration.viewCollaborators'], {
          ns: 'workflow',
          count: onlineUsers.length,
        })}
        align="start"
        sideOffset={4}
        className="flex max-h-50 w-60 flex-col overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[10px]"
      >
        {onlineUsers.map((user) => {
          const isCurrentUser = user.user_id === currentUserId
          const avatarUrl = isConnected ? avatarUrls?.[user.sid] : undefined
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
              <CollaboratorAvatar size="sm" collaborator={toCollaborator(user, avatarUrl)} />
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
