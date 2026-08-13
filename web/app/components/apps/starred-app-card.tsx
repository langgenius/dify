'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { zIconType } from '@dify/contracts/api/console/apps/zod.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { getRedirectionPath } from '@/utils/app-redirection'
import { hasOnlyAppPreviewPermission } from '@/utils/permission'
import { formatTime } from '@/utils/time'
import { AppCardActionBar } from './app-card/action-bar'

type StarredAppCardProps = {
  app: AppPartial
  stepByStepTourCardTarget?: string
  stepByStepTourCardHighlightPart?: string
}

export const StarredAppCard = memo(
  ({ app, stepByStepTourCardTarget, stepByStepTourCardHighlightPart }: StarredAppCardProps) => {
    const { t } = useTranslation()
    const { data: currentUserId } = useSuspenseQuery({
      ...userProfileQueryOptions(),
      select: (data) => data.profile.id,
    })
    const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
    const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
    const isRbacEnabled = systemFeatures.rbac_enabled
    const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
    const appIconType = zIconType.safeParse(app.icon_type).data ?? null

    const editTimeText = useMemo(() => {
      const timestamp = app.updated_at || app.created_at
      if (!timestamp) return ''

      const timeText = formatTime({
        date: timestamp * 1000,
        dateFormat: `${t(($) => $['segment.dateTimeFormat'], { ns: 'datasetDocuments' })}`,
      })
      return `${t(($) => $['segment.editedAt'], { ns: 'datasetDocuments' })} ${timeText}`
    }, [app.created_at, app.updated_at, t])
    const href = getRedirectionPath(app, {
      currentUserId,
      resourceMaintainer: app.maintainer,
      workspacePermissionKeys,
      isRbacEnabled,
    })
    const cardClassName = cn(
      'flex h-18 min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg px-4 py-3 shadow-xs outline-hidden transition-shadow duration-200',
      isPreviewOnly
        ? 'cursor-not-allowed opacity-60 focus-visible:ring-2 focus-visible:ring-state-accent-solid'
        : 'hover:shadow-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    )
    const showPreviewOnlyAccessWarning = useCallback(() => {
      toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
    }, [t])
    const appNameId = useId()
    const cardContent = (
      <>
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
            wrapperClassName="absolute -right-0.5 -bottom-0.5 h-4 w-4 shadow-sm"
            className="size-3"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <div id={appNameId} className="truncate system-md-semibold text-text-secondary">
            {app.name}
          </div>
          <div className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary">
            {app.author_name && <span className="shrink-0 truncate">{app.author_name}</span>}
            {app.author_name && editTimeText && <span className="shrink-0">·</span>}
            {editTimeText && <span className="min-w-0 truncate">{editTimeText}</span>}
          </div>
        </div>
      </>
    )

    return (
      <div className="group relative">
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
          <Link
            href={href}
            data-step-by-step-tour-target={stepByStepTourCardTarget}
            data-step-by-step-tour-highlight-part={stepByStepTourCardHighlightPart}
            className={cardClassName}
          >
            {cardContent}
          </Link>
        )}
        {!isPreviewOnly && <AppCardActionBar app={app} />}
      </div>
    )
  },
)
