'use client'

import type { App } from '@/types/app'
import { useTranslation } from 'react-i18next'
import { APP_LIST_GRID_CLASS_NAME } from './constants'
import { StarredAppCard } from './starred-app-card'

type StarredAppListProps = {
  apps: App[]
  onRefresh?: () => void
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex h-7 flex-col items-start px-8 pt-3">
      <div className="flex h-4 w-full items-center">
        <div className="system-xs-medium-uppercase text-text-tertiary uppercase">{label}</div>
      </div>
    </div>
  )
}

export function StarredAppList({
  apps,
  onRefresh,
}: StarredAppListProps) {
  const { t } = useTranslation()

  if (apps.length === 0)
    return null

  return (
    <>
      <SectionDivider label={t($ => $['studio.starred'], { ns: 'app' })} />
      <div className={APP_LIST_GRID_CLASS_NAME}>
        {apps.map(app => (
          <StarredAppCard
            key={app.id}
            app={app}
            onRefresh={onRefresh}
          />
        ))}
      </div>
      <SectionDivider label={t($ => $['studio.allApps'], { ns: 'app' })} />
    </>
  )
}
