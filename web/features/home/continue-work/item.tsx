'use client'

import type { RecentAppResponse } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { getRedirectionPath } from '@/utils/app-redirection'
import { hasOnlyAppPreviewPermission } from '@/utils/permission'

const appModeLabelKeys = {
  'advanced-chat': 'types.advanced',
  'agent-chat': 'types.agent',
  chat: 'types.chatbot',
  completion: 'types.completion',
  workflow: 'types.workflow',
} as const satisfies Record<RecentAppResponse['mode'], string>

type ContinueWorkItemProps = {
  app: RecentAppResponse
}

export function ContinueWorkItem({ app }: ContinueWorkItemProps) {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const appNameId = useId()
  const appModeId = useId()
  const appMetadataId = useId()
  const [isPrefetchEnabled, setIsPrefetchEnabled] = useState(false)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const updatedAt = app.updated_at * 1000
  const appModeLabel = t(($) => $[appModeLabelKeys[app.mode]], { ns: 'app' })
  const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
  const href = getRedirectionPath(app, {
    currentUserId,
    resourceMaintainer: app.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  })
  const cardClassName = cn(
    'relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 pt-4 pb-4 text-left shadow-xs shadow-shadow-shadow-3',
    isPreviewOnly && 'cursor-not-allowed opacity-60',
  )

  const showPreviewOnlyAccessWarning = () => {
    toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
  }

  const cardContent = (
    <>
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={app.icon_type}
          icon={app.icon ?? undefined}
          background={app.icon_background}
          imageUrl={app.icon_url}
        />
        <AppTypeIcon
          type={app.mode}
          wrapperClassName="absolute -right-0.5 -bottom-0.5 size-4 rounded-sm border-components-panel-on-panel-item-bg shadow-xs shadow-shadow-shadow-3"
          className="size-3"
        />
      </div>
      <div className="min-w-0 py-px">
        <h3 id={appNameId} className="truncate system-md-semibold text-text-secondary">
          {app.name}
        </h3>
        <span id={appModeId} className="sr-only">
          {appModeLabel}
        </span>
        <div
          id={appMetadataId}
          className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary"
        >
          {app.author_name && (
            <>
              <span className="min-w-0 truncate">{app.author_name}</span>
              <span className="shrink-0" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className="min-w-0 truncate">
            {t(($) => $['continueWork.editedAt'], {
              ns: 'explore',
              time: formatTimeFromNow(updatedAt),
            })}
          </span>
        </div>
      </div>
    </>
  )

  if (isPreviewOnly) {
    return (
      <div className={cardClassName}>
        <button
          type="button"
          aria-labelledby={`${appNameId} ${appModeId}`}
          aria-describedby={appMetadataId}
          className="absolute inset-0 z-10 cursor-not-allowed touch-manipulation appearance-none rounded-xl border-0 bg-transparent p-0 outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={showPreviewOnlyAccessWarning}
        />
        {cardContent}
      </div>
    )
  }

  return (
    <Link
      href={href}
      prefetch={isPrefetchEnabled ? null : false}
      onMouseEnter={() => setIsPrefetchEnabled(true)}
      onFocus={() => setIsPrefetchEnabled(true)}
      aria-labelledby={`${appNameId} ${appModeId}`}
      aria-describedby={appMetadataId}
      className={cn(
        cardClassName,
        'touch-manipulation outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
      )}
    >
      {cardContent}
    </Link>
  )
}
