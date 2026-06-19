'use client'

import type { App } from '@/types/app'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import Link from '@/next/link'
import { getRedirectionPath } from '@/utils/app-redirection'
import { formatTime } from '@/utils/time'
import { AppCardActionBar } from './app-card'

type StarredAppCardProps = {
  app: App
  onRefresh?: () => void
}

export function StarredAppCard({ app, onRefresh }: StarredAppCardProps) {
  const { t } = useTranslation()
  const currentUserId = useAppContextSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys)

  const editTimeText = useMemo(() => {
    const timestamp = app.updated_at || app.created_at
    if (!timestamp)
      return ''

    const timeText = formatTime({
      date: timestamp * 1000,
      dateFormat: `${t('segment.dateTimeFormat', { ns: 'datasetDocuments' })}`,
    })
    return `${t('segment.editedAt', { ns: 'datasetDocuments' })} ${timeText}`
  }, [app.created_at, app.updated_at, t])
  const href = getRedirectionPath(app, {
    currentUserId,
    resourceMaintainer: app.maintainer,
    workspacePermissionKeys,
  })

  return (
    <div className="group relative">
      <Link
        href={href}
        className="flex h-[72px] min-w-0 items-center gap-3 overflow-hidden rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg px-4 py-3 shadow-xs outline-hidden transition-shadow duration-200 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      >
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={app.icon_type}
            icon={app.icon}
            background={app.icon_background}
            imageUrl={app.icon_url}
          />
          <AppTypeIcon type={app.mode} wrapperClassName="absolute -right-0.5 -bottom-0.5 h-4 w-4 shadow-sm" className="size-3" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-px">
          <div className="truncate system-md-semibold text-text-secondary">{app.name}</div>
          <div className="flex min-w-0 items-center gap-1 system-xs-regular text-text-tertiary">
            {app.author_name && <span className="shrink-0 truncate">{app.author_name}</span>}
            {app.author_name && editTimeText && <span className="shrink-0">·</span>}
            {editTimeText && <span className="min-w-0 truncate">{editTimeText}</span>}
          </div>
        </div>
      </Link>
      <AppCardActionBar app={app} onRefresh={onRefresh} />
    </div>
  )
}
