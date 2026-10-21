'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { StudioListLink } from '@/features/studio-list-navigation/navigation'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getRedirectionPath } from '@/utils/app-redirection'
import { hasOnlyAppPreviewPermission } from '@/utils/permission'
import { formatTime } from '@/utils/time'
import { AppAvailabilityBadge, AppAvailabilityDetails } from './app-availability'
import { AppCardInteractions } from './app-card/interactions'

type StarredAppCardProps = {
  app: AppPartial
  stepByStepTourCardTarget?: string
  stepByStepTourCardHighlightPart?: string
}

export const StarredAppCard = memo(
  ({ app, stepByStepTourCardTarget, stepByStepTourCardHighlightPart }: StarredAppCardProps) => {
    const { t } = useTranslation(['app', 'common', 'time'])
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
    const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
    const isRbacEnabled = systemFeatures.rbac_enabled
    const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)

    const editTimeText = useMemo(() => {
      const timestamp = app.updated_at || app.created_at
      if (!timestamp) return ''

      const timeText = formatTime({
        date: timestamp * 1000,
        dateFormat: `${t(($) => $['dateFormats.compact'], { ns: 'time' })}`,
      })
      return `${t(($) => $.editedAt, { ns: 'common' })} ${timeText}`
    }, [app.created_at, app.updated_at, t])
    const href = getRedirectionPath(app, {
      currentUserId,
      resourceMaintainer: app.maintainer,
      workspacePermissionKeys,
      isRbacEnabled,
    })
    const cardClassName = cn(
      'flex h-18 min-w-0 items-center gap-3 rounded-xl px-4 py-3 outline-hidden',
      isPreviewOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
    )
    const showPreviewOnlyAccessWarning = useCallback(() => {
      toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
    }, [t])
    const appNameId = useId()
    const cardContent = (
      <>
        <div className="relative shrink-0">
          <AppIcon size="large" icon={app} />
          <AppTypeIcon
            type={app.mode}
            wrapperClassName="absolute -right-0.5 -bottom-0.5 h-4 w-4 shadow-sm"
            className="size-3"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <div className="flex min-w-0 items-center system-md-semibold text-text-secondary">
            <div id={appNameId} className="min-w-0 truncate">
              {app.name}
            </div>
          </div>
          <div
            className={cn(
              'flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary',
              app.availability === 'unavailable' && 'pr-5',
            )}
          >
            <AppAvailabilityBadge app={app} />
            {app.author_name && <span className="min-w-0 truncate">{app.author_name}</span>}
            {app.author_name && editTimeText && <span className="shrink-0">·</span>}
            {editTimeText && <span className="min-w-0 truncate">{editTimeText}</span>}
          </div>
        </div>
      </>
    )

    return (
      <li
        className={cn(
          "group relative isolate overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-shadow duration-200 after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt has-[>a:focus-visible]:after:inset-ring-2 has-[>a:focus-visible]:after:inset-ring-state-accent-solid has-[>button:focus-visible]:after:inset-ring-2 has-[>button:focus-visible]:after:inset-ring-state-accent-solid motion-reduce:transition-none",
          !isPreviewOnly &&
            'hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5 has-data-popup-open:bg-components-card-bg-alt has-data-popup-open:shadow-md has-data-popup-open:shadow-shadow-shadow-5 [@media(hover:none)]:bg-components-card-bg-alt',
        )}
      >
        {isPreviewOnly ? (
          <button
            type="button"
            aria-labelledby={appNameId}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={cn(cardClassName, 'text-left')}
            onClick={showPreviewOnlyAccessWarning}
          >
            {cardContent}
          </button>
        ) : (
          <AppCardInteractions app={app}>
            <StudioListLink
              href={href}
              aria-labelledby={appNameId}
              data-step-by-step-tour-target={stepByStepTourCardTarget}
              data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
              className={cardClassName}
            >
              {cardContent}
            </StudioListLink>
          </AppCardInteractions>
        )}
        {app.availability === 'unavailable' && (
          <div className="absolute right-1 bottom-1">
            <AppAvailabilityDetails app={app} />
          </div>
        )}
      </li>
    )
  },
)
