'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type { WorkflowOnlineUser } from '@/models/app'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AppCardTags } from '@/features/tag-management/components/app-card-tags'
import Link from '@/next/link'
import { AppModeEnum } from '@/types/app'
import { getRedirectionPath } from '@/utils/app-redirection'
import {
  getAppACLCapabilities,
  hasOnlyAppPreviewPermission,
  hasPermission,
} from '@/utils/permission'
import { formatTime } from '@/utils/time'
import { AppCardActionBar } from './action-bar'

const EMPTY_ONLINE_USERS: WorkflowOnlineUser[] = []

type AppCardProps = {
  app: AppPartial
  onlineUsers?: WorkflowOnlineUser[]
  onOpenTagManagement?: () => void
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourCardTarget?: string
  stepByStepTourCardHighlightPart?: string
  stepByStepTourActionMenuHighlightPart?: string
}

export const AppCard = memo(
  ({
    app,
    onlineUsers = EMPTY_ONLINE_USERS,
    onOpenTagManagement,
    stepByStepTourActionMenuOpen = false,
    stepByStepTourCardTarget,
    stepByStepTourCardHighlightPart,
    stepByStepTourActionMenuHighlightPart,
  }: AppCardProps) => {
    const { t } = useTranslation()
    const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
    const isRbacEnabled = systemFeatures.rbac_enabled
    const resourceMaintainer = app.maintainer ?? undefined
    const maintainerPermissionOptions = useMemo(
      () => ({
        currentUserId,
        resourceMaintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
      [currentUserId, isRbacEnabled, resourceMaintainer, workspacePermissionKeys],
    )
    const appACLCapabilities = useMemo(
      () => getAppACLCapabilities(app.permission_keys, maintainerPermissionOptions),
      [app.permission_keys, maintainerPermissionOptions],
    )
    const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
    const canManageAppTags = hasPermission(workspacePermissionKeys, 'app.tag.manage')
    const canBindOrUnbindTags = !isPreviewOnly && (canManageAppTags || appACLCapabilities.canEdit)
    const editTimeText = useMemo(() => {
      const timestamp = app.updated_at || app.created_at
      if (!timestamp) return ''

      const timeText = formatTime({
        date: timestamp * 1000,
        dateFormat: `${t(($) => $['segment.dateTimeFormat'], { ns: 'datasetDocuments' })}`,
      })
      return `${t(($) => $['segment.editedAt'], { ns: 'datasetDocuments' })} ${timeText}`
    }, [app.updated_at, app.created_at, t])

    const appModeLabel = useMemo(() => {
      switch (app.mode) {
        case AppModeEnum.CHAT:
          return t(($) => $['types.chatbot'], { ns: 'app' })
        case AppModeEnum.ADVANCED_CHAT:
          return t(($) => $['types.advanced'], { ns: 'app' })
        case AppModeEnum.AGENT_CHAT:
          return t(($) => $['types.agent'], { ns: 'app' })
        case AppModeEnum.COMPLETION:
          return t(($) => $['types.completion'], { ns: 'app' })
        case AppModeEnum.WORKFLOW:
          return t(($) => $['types.workflow'], { ns: 'app' })
        default:
          return app.mode
      }
    }, [app.mode, t])

    const onlinePresenceUsers = useMemo(() => {
      return onlineUsers
        .map((user, index) => {
          const id = user.user_id || user.sid || `${app.id}-online-${index}`
          const name = user.username || user.user_id || user.sid || `${index + 1}`
          return {
            id,
            name,
            avatar_url: user.avatar || null,
          }
        })
        .filter((user) => Boolean(user.id))
    }, [app.id, onlineUsers])
    const appNameId = useId()
    const appDescriptionId = useId()
    const appIconType = zIconType.safeParse(app.icon_type).data ?? null
    const appHref = getRedirectionPath(app, maintainerPermissionOptions)
    const appCardClassName = cn(
      'inline-flex h-full w-full touch-manipulation flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs outline-hidden transition-shadow duration-200 ease-in-out',
      isPreviewOnly
        ? 'cursor-not-allowed opacity-60 focus-visible:ring-2 focus-visible:ring-state-accent-solid'
        : 'cursor-pointer hover:shadow-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    )
    const showPreviewOnlyAccessWarning = useCallback(() => {
      toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
    }, [t])
    const appCardContent = (
      <>
        <div className="flex shrink-0 items-center gap-3 pt-4 pr-4 pb-2 pl-4">
          <div className="relative shrink-0">
            <AppIcon
              size="large"
              iconType={appIconType}
              icon={app.icon ?? undefined}
              background={app.icon_background}
              imageUrl={app.icon_url}
            />
            <AppTypeIcon
              type={app.mode}
              wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm"
              className="size-3"
            />
          </div>
          <div className="flex w-0 grow flex-col gap-1 py-px">
            <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
              <div id={appNameId} className="truncate">
                {app.name}
              </div>
            </div>
            <div className="truncate system-2xs-medium-uppercase text-text-tertiary">
              {appModeLabel}
            </div>
          </div>
          {onlinePresenceUsers.length > 0 && (
            <div className="ml-3 flex shrink-0 items-start">
              <UserAvatarList
                users={onlinePresenceUsers}
                size="xxs"
                maxVisible={3}
                className="justify-end"
              />
            </div>
          )}
        </div>
        <div className="shrink-0 px-4 py-1 system-xs-regular text-text-tertiary">
          <div id={appDescriptionId} className="line-clamp-2 min-h-8">
            {app.description}
          </div>
        </div>
        <div className="flex h-6.5 shrink-0 items-start px-3" />
        <div className="flex min-w-0 shrink-0 items-center overflow-hidden pt-2 pr-4 pb-3 pl-4 system-xs-regular text-text-tertiary">
          <div className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
            {app.author_name && (
              <>
                <div className="min-w-0 truncate">{app.author_name}</div>
                <div className="shrink-0">·</div>
              </>
            )}
            <div className="min-w-0 truncate">{editTimeText}</div>
          </div>
        </div>
      </>
    )

    return (
      <div className="group relative col-span-1 h-41.5">
        {isPreviewOnly ? (
          <button
            type="button"
            aria-labelledby={appNameId}
            aria-describedby={app.description ? appDescriptionId : undefined}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={cn(appCardClassName, 'text-left')}
            onClick={showPreviewOnlyAccessWarning}
          >
            {appCardContent}
          </button>
        ) : (
          <Link
            href={appHref}
            aria-labelledby={appNameId}
            aria-describedby={app.description ? appDescriptionId : undefined}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={appCardClassName}
          >
            {appCardContent}
          </Link>
        )}
        {!isPreviewOnly && (
          <AppCardActionBar
            app={app}
            stepByStepTourActionMenuOpen={stepByStepTourActionMenuOpen}
            stepByStepTourActionMenuHighlightPart={stepByStepTourActionMenuHighlightPart}
          />
        )}
        <div className="absolute top-26 right-3 left-3 flex h-6.5 min-w-0 items-start">
          <AppCardTags
            appId={app.id}
            tags={app.tags ?? []}
            canBindOrUnbindTags={canBindOrUnbindTags}
            onOpenTagManagement={onOpenTagManagement}
          />
        </div>
      </div>
    )
  },
)
