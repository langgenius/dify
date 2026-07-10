'use client'

import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import Link from '@/next/link'
import { getRedirectionPath } from '@/utils/app-redirection'
import { hasOnlyAppPreviewPermission } from '@/utils/permission'

type ContinueWorkItemProps = {
  app: App
}

const ContinueWorkItem = ({
  app,
}: ContinueWorkItemProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const isRbacEnabled = systemFeatures.rbac_enabled
  const updatedAt = (app.updated_at || app.created_at) * 1000
  const isPreviewOnly = hasOnlyAppPreviewPermission(app.permission_keys)
  const href = getRedirectionPath(app, {
    currentUserId,
    resourceMaintainer: app.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  })
  const cardClassName = cn(
    'flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-4 pt-4 pb-4 shadow-xs shadow-shadow-shadow-3',
    isPreviewOnly && 'cursor-not-allowed opacity-60',
  )

  const showPreviewOnlyAccessWarning = () => {
    toast.warning(t('noAccessResourcePermission', { ns: 'app' }))
  }

  const handlePreviewOnlyCardKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return

    event.preventDefault()
    showPreviewOnlyAccessWarning()
  }

  const cardContent = (
    <>
      <div className="relative shrink-0">
        <AppIcon
          size="large"
          iconType={app.icon_type}
          icon={app.icon}
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
        <h3 className="truncate system-md-semibold text-text-secondary">
          {app.name}
        </h3>
        <div className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary">
          <span className="shrink-0">{app.author_name}</span>
          <span className="shrink-0">·</span>
          <span className="min-w-0 truncate">{t('continueWork.editedAt', { ns: 'explore', time: formatTimeFromNow(updatedAt) })}</span>
        </div>
      </div>
    </>
  )

  if (isPreviewOnly) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={app.name}
        aria-disabled="true"
        className={cardClassName}
        onClick={showPreviewOnlyAccessWarning}
        onKeyDown={handlePreviewOnlyCardKeyDown}
      >
        {cardContent}
      </div>
    )
  }

  return (
    <Link href={href} className={cardClassName}>
      {cardContent}
    </Link>
  )
}

export default React.memo(ContinueWorkItem)
